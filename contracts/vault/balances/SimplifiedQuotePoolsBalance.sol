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
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

import "./BalanceAllocation.sol";
import "../../math/FixedPoint.sol";

contract SimplifiedQuotePoolsBalance {
    using SafeCast for uint256;
    using BalanceAllocation for bytes32;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Data for Pools with Simplified Quote Pool Optimization setting
    //
    // These Pools use the IPoolQuoteSimplified interface, and so the Vault must read the balance of the two tokens in
    // the swap. The best solution is to use a mapping from token to balance, which lets us read or write any token's
    // balance in a  single storage access.
    // We also keep a set with all tokens in the Pool in order to implement getPoolTokens, and update this set when
    // cash is added or removed from the pool. Tokens in the set always have a non-zero balance, so we don't need to
    // check the set for token existence during a swap: the non-zero balance check achieves this for less gas.

    mapping(bytes32 => EnumerableSet.AddressSet) internal _simplifiedQuotePoolsTokens;
    mapping(bytes32 => mapping(IERC20 => bytes32)) internal _simplifiedQuotePoolsBalances;

    /**
     * @dev Returns an array with all the tokens in a Simplified Quote Pool. This order may change when tokens are added
     * to or removed from the Pool.
     */
    function _getSimplifiedQuotePoolTokens(bytes32 poolId) internal view returns (IERC20[] memory) {
        IERC20[] memory tokens = new IERC20[](_simplifiedQuotePoolsTokens[poolId].length());

        for (uint256 i = 0; i < tokens.length; ++i) {
            tokens[i] = IERC20(_simplifiedQuotePoolsTokens[poolId].at(i));
        }

        return tokens;
    }

    /**
     * @dev Returns the balance for a token in a Simplified Quote Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     */
    function _getSimplifiedQuotePoolBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        bytes32 balance = _simplifiedQuotePoolsBalances[poolId][token];
        bool existsToken = balance.isNotZero() || _simplifiedQuotePoolsTokens[poolId].contains(address(token));
        require(existsToken, "ERR_TOKEN_NOT_REGISTERED");
        return balance;
    }

    /**
     * @dev Registers a list of tokens in a Simplified Quote Pool.
     *
     * Requirements:
     *
     * - Each token must not be the zero address.
     * - Each token must not be registered in the Pool.
     */
    function _registerSimplifiedQuotePoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableSet.AddressSet storage poolTokens = _simplifiedQuotePoolsTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            require(token != IERC20(0), "ERR_TOKEN_IS_ZERO");
            bool added = poolTokens.add(address(token));
            require(added, "ERR_TOKEN_ALREADY_REGISTERED");
        }
    }

    /**
     * @dev Unregisters a list of tokens in a Simplified Quote Pool.
     *
     * Requirements:
     *
     * - Each token must be registered in the Pool.
     * - Each token must have non balance in the Vault.
     */
    function _unregisterSimplifiedQuotePoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableSet.AddressSet storage poolTokens = _simplifiedQuotePoolsTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            require(_simplifiedQuotePoolsBalances[poolId][token].isZero(), "ERR_TOKEN_BALANCE_IS_NOT_ZERO");
            bool removed = poolTokens.remove(address(token));
            require(removed, "ERR_TOKEN_NOT_REGISTERED");
            // No need to delete the balance entries, since they already are zero
        }
    }

    /**
     * @dev Adds cash to a Simplified Quote Pool for a list of tokens. This function doesn't check that the lengths of
     * `tokens` and `amounts` match, it is responsibility of the caller to ensure that.
     *
     * Requirements:
     *
     * - Each token must be registered in the pool
     * - Amounts can be zero
     */
    function _increaseSimplifiedQuotePoolCash(
        bytes32 poolId,
        IERC20[] memory tokens,
        uint256[] memory amounts
    ) internal {
        EnumerableSet.AddressSet storage poolTokens = _simplifiedQuotePoolsTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            uint128 amount = amounts[i].toUint128();
            _updateSimplifiedQuotePoolBalance(poolTokens, poolId, tokens[i], BalanceAllocation.increaseCash, amount);
        }
    }

    /**
     * @dev Removes cash from a Simplified Quote Pool for a list of tokens. This function doesn't check that the lengths
     *  of `tokens` and `amounts` match, it is responsibility of the caller to ensure that.
     *
     * Requirements:
     *
     * - Each token must be registered in the Pool.
     * - Each amount must be less or equal than the Pool's cash for that token.
     */
    function _decreaseSimplifiedQuotePoolCash(
        bytes32 poolId,
        IERC20[] memory tokens,
        uint256[] memory amounts
    ) internal {
        EnumerableSet.AddressSet storage poolTokens = _simplifiedQuotePoolsTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            uint128 amount = amounts[i].toUint128();
            _updateSimplifiedQuotePoolBalance(poolTokens, poolId, tokens[i], BalanceAllocation.decreaseCash, amount);
        }
    }

    function _simplifiedQuotePoolCashToManaged(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updateSimplifiedQuotePoolBalance(poolId, token, BalanceAllocation.cashToManaged, amount);
    }

    function _simplifiedQuotePoolManagedToCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updateSimplifiedQuotePoolBalance(poolId, token, BalanceAllocation.managedToCash, amount);
    }

    function _setSimplifiedQuotePoolManagedBalance(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updateSimplifiedQuotePoolBalance(poolId, token, BalanceAllocation.setManagedBalance, amount);
    }

    function _simplifiedQuotePoolIsManaged(bytes32 poolId, IERC20 token) internal view returns (bool) {
        EnumerableSet.AddressSet storage poolTokens = _simplifiedQuotePoolsTokens[poolId];
        bytes32 currentBalance = _getSimplifiedQuotePoolTokenBalance(poolTokens, poolId, token);
        return currentBalance.isManaged();
    }

    function _updateSimplifiedQuotePoolBalance(
        bytes32 poolId,
        IERC20 token,
        function(bytes32, uint128) pure returns (bytes32) mutation,
        uint128 amount
    ) internal {
        EnumerableSet.AddressSet storage poolTokens = _simplifiedQuotePoolsTokens[poolId];
        _updateSimplifiedQuotePoolBalance(poolTokens, poolId, token, mutation, amount);
    }

    function _updateSimplifiedQuotePoolBalance(
        EnumerableSet.AddressSet storage poolTokens,
        bytes32 poolId,
        IERC20 token,
        function(bytes32, uint128) pure returns (bytes32) mutation,
        uint128 amount
    ) internal {
        bytes32 currentBalance = _getSimplifiedQuotePoolTokenBalance(poolTokens, poolId, token);
        _simplifiedQuotePoolsBalances[poolId][token] = mutation(currentBalance, amount);
    }

    function _getSimplifiedQuotePoolTokenBalance(
        EnumerableSet.AddressSet storage poolTokens,
        bytes32 poolId,
        IERC20 token
    ) internal view returns (bytes32) {
        require(poolTokens.contains(address(token)), "ERR_TOKEN_NOT_REGISTERED");
        return _simplifiedQuotePoolsBalances[poolId][token];
    }
}
