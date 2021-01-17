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

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./BalanceAllocation.sol";
import "../../math/FixedPoint.sol";
import "../../vendor/EnumerableMap.sol";

contract StandardPoolsBalance {
    using SafeCast for uint256;
    using BalanceAllocation for bytes32;
    using EnumerableMap for EnumerableMap.IERC20ToBytes32Map;

    // Data for Pools with Standard Pool Optimization setting
    //
    // These Pools use the IPoolQuote interface, which means the Vault must query the balance for *all* of their tokens
    // in every swap. If we kept a mapping of token to balance plus a set (array) of tokens, it'd be very gas intensive
    // to read all token addresses just to then do a lookup on the balance mapping.
    // Instead, we use our customized EnumerableMap, which lets us read the N balances in N+1 storage accesses (one for
    // the number of tokens in the Pool), as well as access the index of any token in a single read (required for the
    // IPoolQuote call) and update an entry's value given its index.
    // This map is also what we use to list all tokens in the Pool (for getPoolTokens). However, tokens in the map
    // always have a non-zero balance, so we don't need to check the map for token existence during a swap: the non-zero
    // balance check achieves this for less gas.

    mapping(bytes32 => EnumerableMap.IERC20ToBytes32Map) internal _standardPoolsBalances;

    /**
     * @dev Returns an array with all the tokens in a Standard Pool. This order may change when tokens are added to or
     * removed from the Pool.
     */
    function _getStandardPoolTokens(bytes32 poolId) internal view returns (IERC20[] memory) {
        IERC20[] memory tokens = new IERC20[](_standardPoolsBalances[poolId].length());

        for (uint256 i = 0; i < tokens.length; ++i) {
            (IERC20 token, ) = _standardPoolsBalances[poolId].at(i);
            tokens[i] = token;
        }

        return tokens;
    }

    /**
     * @dev Returns the balance for a token in a Standard Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     */
    function _getStandardPoolBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        EnumerableMap.IERC20ToBytes32Map storage poolBalances = _standardPoolsBalances[poolId];
        return _getStandardPoolTokenBalance(poolBalances, token);
    }

    /**
     * @dev Registers a list of tokens in a Standard Pool.
     *
     * Requirements:
     *
     * - Each token must not be the zero address.
     * - Each token must not be registered in the Pool.
     */
    function _registerStandardPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableMap.IERC20ToBytes32Map storage poolBalances = _standardPoolsBalances[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            require(token != IERC20(0), "ERR_TOKEN_IS_ZERO");
            bool added = poolBalances.set(token, 0);
            require(added, "ERR_TOKEN_ALREADY_REGISTERED");
            // No need to delete the balance entries, since they already are zero
        }
    }

    /**
     * @dev Unregisters a list of tokens in a Standard Pool.
     *
     * Requirements:
     *
     * - Each token must be registered in the Pool.
     * - Each token must have non balance in the Vault.
     */
    function _unregisterStandardPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableMap.IERC20ToBytes32Map storage poolBalances = _standardPoolsBalances[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            bytes32 currentBalance = _getStandardPoolTokenBalance(poolBalances, token);
            require(currentBalance.isZero(), "ERR_TOKEN_BALANCE_IS_NOT_ZERO");
            poolBalances.remove(token);
        }
    }

    /**
     * @dev Adds cash to a Standard Pool for a list of tokens. This function doesn't check that the lengths of
     * `tokens` and `amounts` match, it is responsibility of the caller to ensure that.
     *
     * Requirements:
     *
     * - Each token must be registered in the pool
     * - Amounts can be zero
     */
    function _increaseStandardPoolCash(
        bytes32 poolId,
        IERC20[] memory tokens,
        uint256[] memory amounts
    ) internal {
        EnumerableMap.IERC20ToBytes32Map storage poolBalances = _standardPoolsBalances[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            uint128 amount = amounts[i].toUint128();
            _updateStandardPoolBalance(poolBalances, tokens[i], BalanceAllocation.increaseCash, amount);
        }
    }

    /**
     * @dev Removes cash from a Standard Pool for a list of tokens. This function doesn't check that the lengths of
     * `tokens` and `amounts` match, it is responsibility of the caller to ensure that.
     *
     * Requirements:
     *
     * - Each token must be registered in the Pool.
     * - Each amount must be less or equal than the Pool's cash for that token.
     */
    function _decreaseStandardPoolCash(
        bytes32 poolId,
        IERC20[] memory tokens,
        uint256[] memory amounts
    ) internal {
        EnumerableMap.IERC20ToBytes32Map storage poolBalances = _standardPoolsBalances[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            uint128 amount = amounts[i].toUint128();
            _updateStandardPoolBalance(poolBalances, tokens[i], BalanceAllocation.decreaseCash, amount);
        }
    }

    function _standardPoolCashToManaged(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updateStandardPoolBalance(poolId, token, BalanceAllocation.cashToManaged, amount);
    }

    function _standardPoolManagedToCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updateStandardPoolBalance(poolId, token, BalanceAllocation.managedToCash, amount);
    }

    function _setStandardPoolManagedBalance(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updateStandardPoolBalance(poolId, token, BalanceAllocation.setManagedBalance, amount);
    }

    function _standardPoolIsManaged(bytes32 poolId, IERC20 token) internal view returns (bool) {
        EnumerableMap.IERC20ToBytes32Map storage poolBalances = _standardPoolsBalances[poolId];
        bytes32 currentBalance = _getStandardPoolTokenBalance(poolBalances, token);
        return currentBalance.isManaged();
    }

    function _updateStandardPoolBalance(
        bytes32 poolId,
        IERC20 token,
        function(bytes32, uint128) pure returns (bytes32) mutation,
        uint128 amount
    ) internal {
        EnumerableMap.IERC20ToBytes32Map storage poolBalances = _standardPoolsBalances[poolId];
        _updateStandardPoolBalance(poolBalances, token, mutation, amount);
    }

    function _updateStandardPoolBalance(
        EnumerableMap.IERC20ToBytes32Map storage poolBalances,
        IERC20 token,
        function(bytes32, uint128) pure returns (bytes32) mutation,
        uint128 amount
    ) internal {
        bytes32 currentBalance = _getStandardPoolTokenBalance(poolBalances, token);
        poolBalances.set(token, mutation(currentBalance, amount));
    }

    function _getStandardPoolTokenBalance(EnumerableMap.IERC20ToBytes32Map storage poolBalances, IERC20 token)
        internal
        view
        returns (bytes32)
    {
        return poolBalances.get(token, "ERR_TOKEN_NOT_REGISTERED");
    }
}
