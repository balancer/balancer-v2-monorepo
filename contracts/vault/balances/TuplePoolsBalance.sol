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

import "hardhat/console.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../vendor/EnumerableMap.sol";

import "../../math/FixedPoint.sol";

import "./CashInvested.sol";

contract TuplePoolsBalance {
    using EnumerableMap for EnumerableMap.IERC20ToBytes32Map;
    using CashInvested for bytes32;

    // Data for Pools with Tuple Trading Strategies
    //
    // These Pools query the balance for *all* of their tokens in every swap. If we kept a mapping of token to balance
    // plus a set (array) of tokens, it'd lead to very inefficient data accesses as we'd need to read the token
    // addresses just to then do a lookup on the mapping.
    // Instead, we use our customized EnumerableMap, which lets us read the N balances in N+1 storage accesses (one for
    // the number of tokens in the Pool), as well as access the index of any token in a single read (required for the
    // ITupleTradingStrategy call) and update an entry's value given its index.
    // This map is also what we use to list all tokens in the Pool (for getPoolTokens). However, tokens in the map
    // always have a non-zero balance, so we don't need to check the map for token existence during a swap: the non-zero
    // balance check achieves this for less gas.

    mapping(bytes32 => EnumerableMap.IERC20ToBytes32Map) internal _poolTupleTokenBalance;

    /**
     * @dev Returns an array with all the tokens in a Tuple Pool. This order may change when tokens are added to or
     * removed from the Pool.
     */
    function _getTuplePoolTokens(bytes32 poolId) internal view returns (IERC20[] memory) {
        IERC20[] memory tokens = new IERC20[](_poolTupleTokenBalance[poolId].length());

        for (uint256 i = 0; i < tokens.length; ++i) {
            (IERC20 token, ) = _poolTupleTokenBalance[poolId].at(i);
            tokens[i] = token;
        }

        return tokens;
    }

    /**
     * @dev Returns the balance for a token in a Tuple Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     */
    function _getTuplePoolBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        return _poolTupleTokenBalance[poolId].get(token);
    }

    /**
     * TODO
     */
    function _registerTuplePoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableMap.IERC20ToBytes32Map storage poolBalances = _poolTupleTokenBalance[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            require(token != IERC20(0), "ERR_TOKEN_IS_ZERO");
            require(!poolBalances.contains(token), "ERR_TOKEN_ALREADY_REGISTERED");
            poolBalances.set(token, 0);
        }
    }

    /**
     * TODO
     */
    function _unregisterTuplePoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableMap.IERC20ToBytes32Map storage poolBalances = _poolTupleTokenBalance[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            require(poolBalances.contains(token), "ERR_TOKEN_NOT_REGISTERED");
            require(poolBalances.get(token).isZero(), "ERR_TOKEN_BALANCE_IS_NOT_ZERO");
            poolBalances.remove(token);
        }
    }

    /**
     * @dev Adds cash to a Tuple Pool for a given token. If the token was not previously in the Pool (if it didn't have
     * any funds for it), the token is then added to the Pool. After this function is called, 'token' will be in the
     * Pool.
     *
     * Requirements:
     *
     * - if `token` is not in the Pool, `amount` must be non-zero.
     */
    function _increaseTuplePoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        bytes32 currentBalance;

        // Alternatively we could check for non-zero balance
        if (_poolTupleTokenBalance[poolId].contains(token)) {
            currentBalance = _poolTupleTokenBalance[poolId].get(token);
        } else {
            // New token - it will be added to the map once 'set' is called

            require(amount > 0, "New token amount is zero");
            currentBalance = CashInvested.toBalance(0, 0);
        }

        // amount is always non-zero, so we're never adding a zero-balance token to the map
        _poolTupleTokenBalance[poolId].set(token, currentBalance.increaseCash(amount));
    }

    /**
     * @dev Removes cash from a Tuple Pool for a given token. If this fully drains the Pool's balance for that token
     * (including invested balance), then the token is removed from the Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     * - `amount` must be less or equal than the Pool's cash for that token.
     */
    function _decreaseTuplePoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        // Alternatively we could check for non-zero balance
        require(_poolTupleTokenBalance[poolId].contains(token), "Token not in pool");

        bytes32 currentBalance = _poolTupleTokenBalance[poolId].get(token);
        bytes32 newBalance = currentBalance.decreaseCash(amount);

        if (newBalance.total() == 0) {
            _poolTupleTokenBalance[poolId].remove(token);
        } else {
            _poolTupleTokenBalance[poolId].set(token, newBalance);
        }
    }

    function _investTuplePoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        require(_poolTupleTokenBalance[poolId].contains(token), "Token not in pool");

        bytes32 currentBalance = _poolTupleTokenBalance[poolId].get(token);
        _poolTupleTokenBalance[poolId].set(token, currentBalance.cashToInvested(amount));
    }

    function _divestTuplePoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        require(_poolTupleTokenBalance[poolId].contains(token), "Token not in pool");

        bytes32 currentBalance = _poolTupleTokenBalance[poolId].get(token);
        _poolTupleTokenBalance[poolId].set(token, currentBalance.investedToCash(amount));
    }

    function _setTuplePoolInvestment(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        require(_poolTupleTokenBalance[poolId].contains(token), "Token not in pool");

        bytes32 currentBalance = _poolTupleTokenBalance[poolId].get(token);
        _poolTupleTokenBalance[poolId].set(token, currentBalance.setInvested(amount));
    }

    function _isTuplePoolInvested(bytes32 poolId, IERC20 token) internal view returns (bool) {
        return _poolTupleTokenBalance[poolId].get(token).isInvested();
    }
}
