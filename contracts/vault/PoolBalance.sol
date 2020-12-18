// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.1;

// Imports
import "../vendor/EnumerableSet.sol";
import "../vendor/EnumerableMap.sol";

import "./IVault.sol";
import "./CashInvestedBalance.sol";

// Contracts

/**
 * @title Store the token balances for all pools
 * @author Balancer Labs
 */
contract PoolBalance {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableMap for EnumerableMap.IERC20ToBytes32Map;
    using CashInvestedBalance for bytes32;

    // State variables

    // Tokens in a Pool have non-zero balances, which can be used as a shortcut to check
    // at once if a) a Pool exists and b) a token is in that Pool.

    // Data for Pools with Pair Trading Strategies
    //
    // We keep a set with all tokens in order to implement _getPoolTokens, which is updated when liquidity is added or
    // removed via increase/decreasePoolCash.
    // Balances are stored in a mapping from token to balance, which lets us read or write a token's balance in a single
    // storage access. We don't need to check the set for token existence in a swap: the non-zero balance check does
    // this for much cheaper.
    mapping(bytes32 => EnumerableSet.AddressSet) internal _poolPairTokens;
    mapping(bytes32 => mapping(IERC20 => bytes32)) internal _poolPairTokenBalance;

    // Data for Pools with Tuple Trading Strategies
    //
    // We need to keep a set, again to implement _getPoolTokens, but these Pools also need to be able to query the
    // balance for *all* of their tokens, which means iterating over the elements of this set. If we kept a mapping of
    // token to balance, this access would be very inefficient, as we'd need to read the token addresses just to then
    // do a lookup on the mapping.
    // Instead, we use our customized EnumerableMap, which lets us read the N balances in N+1 storage accesses (one for
    // the number of tokens in the Pool), as well as access the index of any token in a single read (required for the
    // ITupleTradingStrategy call), and update an entry's value given its index.
    mapping(bytes32 => EnumerableMap.IERC20ToBytes32Map) internal _poolTupleTokenBalance;

    // Function declarations

    // All of these functions require that the caller indicate the Pool type of the queried Pool.

    // Internal functions

    // Returns an array with all the tokens in a Pool. This order may change when tokens are added to
    // or removed from the pool
    function _getPoolTokens(bytes32 poolId, IVault.StrategyType strategyType) internal view returns (IERC20[] memory) {
        IERC20[] memory tokens;

        if (strategyType == IVault.StrategyType.PAIR) {
            tokens = new IERC20[](_poolPairTokens[poolId].length());

            for (uint256 i = 0; i < tokens.length; ++i) {
                tokens[i] = IERC20(_poolPairTokens[poolId].at(i));
            }
        } else {
            tokens = new IERC20[](_poolTupleTokenBalance[poolId].length());

            for (uint256 i = 0; i < tokens.length; ++i) {
                (IERC20 token, ) = _poolTupleTokenBalance[poolId].at(i);
                tokens[i] = token;
            }
        }

        return tokens;
    }

    // Returns the balance for a token in a Pool.
    // The token must be in the Pool.
    // Decode the return value using the `CashInvestedBalance` library
    function _getPoolTokenBalance(
        bytes32 poolId,
        IVault.StrategyType strategyType,
        IERC20 token
    ) internal view returns (bytes32) {
        if (strategyType == IVault.StrategyType.PAIR) {
            bytes32 balance = _poolPairTokenBalance[poolId][token];
            require(balance.total() > 0, "Token not in pool");

            return balance;
        } else {
            bytes32 balance = _poolTupleTokenBalance[poolId].get(token);
            return balance;
        }
    }

    // Adds cash to a Pool for a given token. If the token was not previously in the Pool
    //   (i.e., zero balance), the token is added to the Pool.
    // amount must be greater than 0
    function _increasePoolCash(
        bytes32 poolId,
        IVault.StrategyType strategyType,
        IERC20 token,
        uint128 amount
    ) internal {
        if (strategyType == IVault.StrategyType.PAIR) {
            bytes32 currentBalance = _poolPairTokenBalance[poolId][token];
            if (currentBalance.total() == 0) {
                // No tokens with zero balance should ever be in the _poolPairTokens set
                assert(_poolPairTokens[poolId].add(address(token)));
            }

            _poolPairTokenBalance[poolId][token] = currentBalance.increaseCash(amount);
        } else {
            bytes32 currentBalance = _poolTupleTokenBalance[poolId].contains(token)
                ? _poolTupleTokenBalance[poolId].get(token)
                : CashInvestedBalance.toBalance(0, 0);

            // amount is always non-zero, so we're never adding a zero-balance token to the map
            _poolTupleTokenBalance[poolId].set(token, currentBalance.increaseCash(amount));
        }
    }

    // Removes cash from a Pool for a given token. If this fully drains the Pool's balance for that token
    // (including managed balance), then the token is removed from the Pool.
    // Requirements:
    //   - token must be in the Pool.
    //   - amount must be less or equal than the Pool's cash for that token
    function _decreasePoolCash(
        bytes32 poolId,
        IVault.StrategyType strategyType,
        IERC20 token,
        uint128 amount
    ) internal {
        if (strategyType == IVault.StrategyType.PAIR) {
            require(_poolPairTokens[poolId].contains(address(token)), "Token not in pool");

            bytes32 currentBalance = _poolPairTokenBalance[poolId][token];
            bytes32 newBalance = currentBalance.decreaseCash(amount);

            _poolPairTokenBalance[poolId][token] = newBalance;

            if (newBalance.total() == 0) {
                _poolPairTokens[poolId].remove(address(token));
            }
        } else {
            require(_poolTupleTokenBalance[poolId].contains(token), "Token not in pool");

            bytes32 currentBalance = _poolTupleTokenBalance[poolId].get(token);
            bytes32 newBalance = currentBalance.decreaseCash(amount);

            if (newBalance.total() == 0) {
                _poolTupleTokenBalance[poolId].remove(token);
            } else {
                _poolTupleTokenBalance[poolId].set(token, newBalance);
            }
        }
    }

    // Increase a managed token balance in the given pool
    // Increasing the managed balance will decrease the cash available
    function _investPoolCash(
        bytes32 poolId,
        IVault.StrategyType strategyType,
        IERC20 token,
        uint128 amount
    ) internal {
        if (strategyType == IVault.StrategyType.PAIR) {
            bytes32 currentBalance = _poolPairTokenBalance[poolId][token];
            _poolPairTokenBalance[poolId][token] = currentBalance.cashToInvested(amount);
        } else {
            bytes32 currentBalance = _poolTupleTokenBalance[poolId].get(token);
            _poolTupleTokenBalance[poolId].set(token, currentBalance.cashToInvested(amount));
        }
    }

    // Decrease a managed token balance in the given pool
    // Decreasing the managed balance will increase the cash available
    function _divestPoolCash(
        bytes32 poolId,
        IVault.StrategyType strategyType,
        IERC20 token,
        uint128 amount
    ) internal {
        if (strategyType == IVault.StrategyType.PAIR) {
            bytes32 currentBalance = _poolPairTokenBalance[poolId][token];
            _poolPairTokenBalance[poolId][token] = currentBalance.investedToCash(amount);
        } else {
            bytes32 currentBalance = _poolTupleTokenBalance[poolId].get(token);
            _poolTupleTokenBalance[poolId].set(token, currentBalance.investedToCash(amount));
        }
    }

    // Set the managed balance of a token in the given pool
    // This is how the asset manager reports losses/gains
    // (i.e., setting the managed portion lower than it is now would record a loss)
    function _setPoolInvestment(
        bytes32 poolId,
        IVault.StrategyType strategyType,
        IERC20 token,
        uint128 amount
    ) internal {
        if (strategyType == IVault.StrategyType.PAIR) {
            bytes32 currentBalance = _poolPairTokenBalance[poolId][token];
            _poolPairTokenBalance[poolId][token] = currentBalance.setInvested(amount);
        } else {
            bytes32 currentBalance = _poolTupleTokenBalance[poolId].get(token);
            _poolTupleTokenBalance[poolId].set(token, currentBalance.setInvested(amount));
        }
    }

    // Determine whether a token is managed (i.e., has a non-zero managed balance)
    function _isPoolInvested(
        bytes32 poolId,
        IVault.StrategyType strategyType,
        IERC20 token
    ) internal view returns (bool) {
        if (strategyType == IVault.StrategyType.PAIR) {
            return _poolPairTokenBalance[poolId][token].isInvested();
        } else {
            return _poolTupleTokenBalance[poolId].get(token).isInvested();
        }
    }
}
