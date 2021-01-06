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
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

import "../../math/FixedPoint.sol";

import "./CashInvested.sol";

contract PairPoolsBalance {
    using EnumerableSet for EnumerableSet.AddressSet;
    using CashInvested for bytes32;

    // Data for Pools with Pair Trading Strategies
    //
    // When swapping with these Pools, the Vault must provide the balance of the two tokens in the swap. The best
    // solution is to use a mapping from token to balance, which lets us read or write any token's balance in a single
    // storage access.
    // We also keep a set with all tokens in the Pool in order to implement getPoolTokens, and update this set when
    // cash is added or removed from the pool. Tokens in the set always have a non-zero balance, so we don't need to
    // check the set for token existence during a swap: the non-zero balance check achieves this for less gas.

    mapping(bytes32 => EnumerableSet.AddressSet) internal _poolPairTokens;
    mapping(bytes32 => mapping(IERC20 => bytes32)) internal _poolPairTokenBalance;

    /**
     * @dev Returns an array with all the tokens in a Pair Pool. This order may change when tokens are added to or
     * removed from the Pool.
     */
    function _getPairPoolTokens(bytes32 poolId) internal view returns (IERC20[] memory) {
        IERC20[] memory tokens = new IERC20[](_poolPairTokens[poolId].length());

        for (uint256 i = 0; i < tokens.length; ++i) {
            tokens[i] = IERC20(_poolPairTokens[poolId].at(i));
        }

        return tokens;
    }

    /**
     * @dev Returns the balance for a token in a Pair Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     */
    function _getPairPoolBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        bytes32 balance = _poolPairTokenBalance[poolId][token];
        // TODO: is it necessary?
        // require(balance.total() > 0, "Token not in pool");

        return balance;
    }

    /**
     * @dev Registers a list of tokens in a Pair Pool.
     *
     * Requirements:
     *
     * - Each token must not be the zero address.
     * - Each token must not be registered in the Pool.
     */
    function _registerPairTokenPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableSet.AddressSet storage poolTokens = _poolPairTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            require(token != IERC20(0), "ERR_TOKEN_IS_ZERO");
            require(!poolTokens.contains(address(token)), "ERR_TOKEN_ALREADY_REGISTERED");
            poolTokens.add(address(token));
        }
    }

    /**
     * @dev Unregisters a list of tokens in a Pair Pool.
     *
     * Requirements:
     *
     * - Each token must be registered in the Pool.
     * - Each token must have non balance in the Vault.
     */
    function _unregisterPairTokenPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableSet.AddressSet storage poolTokens = _poolPairTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            _ensurePairPoolRegisteredToken(poolTokens, token);
            require(_poolPairTokenBalance[poolId][token].isZero(), "ERR_TOKEN_BALANCE_IS_NOT_ZERO");
            poolTokens.remove(address(token));
        }
    }

    /**
     * @dev Adds cash to a Pair Pool for a list of tokens.
     *
     * Requirements:
     *
     * - Each token must be registered in the pool
     * - Amounts can be zero
     */
    function _increasePairPoolCash(
        bytes32 poolId,
        IERC20[] memory tokens,
        uint128[] memory amounts
    ) internal {
        EnumerableSet.AddressSet storage poolTokens = _poolPairTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            _updatePairPoolTokenBalance(poolTokens, poolId, tokens[i], CashInvested.increaseCash, amounts[i]);
        }
    }

    /**
     * @dev Removes cash from a Pair Pool for a list of tokens.
     *
     * Requirements:
     *
     * - Each token must be registered in the Pool.
     * - Each amount must be less or equal than the Pool's cash for that token.
     */
    function _decreasePairPoolCash(
        bytes32 poolId,
        IERC20[] memory tokens,
        uint128[] memory amounts
    ) internal {
        EnumerableSet.AddressSet storage poolTokens = _poolPairTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            _updatePairPoolTokenBalance(poolTokens, poolId, tokens[i], CashInvested.decreaseCash, amounts[i]);
        }
    }

    function _investPairPoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updatePairPoolTokenBalance(poolId, token, CashInvested.cashToInvested, amount);
    }

    function _divestPairPoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updatePairPoolTokenBalance(poolId, token, CashInvested.investedToCash, amount);
    }

    function _setPairPoolInvestment(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updatePairPoolTokenBalance(poolId, token, CashInvested.setInvested, amount);
    }

    function _isPairPoolInvested(bytes32 poolId, IERC20 token) internal view returns (bool) {
        return _poolPairTokenBalance[poolId][token].isInvested();
    }

    function _updatePairPoolTokenBalance(
        bytes32 poolId,
        IERC20 token,
        function(bytes32, uint128) pure returns (bytes32) mutation,
        uint128 amount
    ) internal {
        EnumerableSet.AddressSet storage poolTokens = _poolPairTokens[poolId];
        _updatePairPoolTokenBalance(poolTokens, poolId, token, mutation, amount);
    }

    function _updatePairPoolTokenBalance(
        EnumerableSet.AddressSet storage poolTokens,
        bytes32 poolId,
        IERC20 token,
        function(bytes32, uint128) pure returns (bytes32) mutation,
        uint128 amount
    ) internal {
        _ensurePairPoolRegisteredToken(poolTokens, token);
        bytes32 currentBalance = _poolPairTokenBalance[poolId][token];
        _poolPairTokenBalance[poolId][token] = mutation(currentBalance, amount);
    }

    function _ensurePairPoolRegisteredToken(EnumerableSet.AddressSet storage poolTokens, IERC20 token) internal view {
        require(poolTokens.contains(address(token)), "ERR_TOKEN_NOT_REGISTERED");
    }
}
