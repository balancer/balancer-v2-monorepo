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

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../lib/helpers/BalancerErrors.sol";
import "../../lib/openzeppelin/EnumerableSet.sol";

import "./BalanceAllocation.sol";
import "../PoolRegistry.sol";

abstract contract MinimalSwapInfoPoolsBalance is PoolRegistry {
    using BalanceAllocation for bytes32;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Data for Pools with Minimal Swap Info Specialization setting
    //
    // These Pools use the IMinimalSwapInfoPool interface, and so the Vault must read the balance of the two tokens
    // in the swap. The best solution is to use a mapping from token to balance, which lets us read or write any token's
    // balance in a single storage access.
    //
    // We also keep a set with all tokens in the Pool, and update this set when cash is added or removed from the pool.
    // Tokens in the set always have a non-zero balance, so we don't need to check the set for token existence during
    // a swap: the non-zero balance check achieves this for less gas.

    mapping(bytes32 => EnumerableSet.AddressSet) internal _minimalSwapInfoPoolsTokens;
    mapping(bytes32 => mapping(IERC20 => bytes32)) internal _minimalSwapInfoPoolsBalances;

    /**
     * @dev Registers a list of tokens in a Minimal Swap Info Pool. This function assumes the given tokens are
     * contracts: it's the responsibility of the function caller to perform this check.
     *
     * Requirements:
     *
     * - Tokens cannot already be registered in the Pool
     */
    function _registerMinimalSwapInfoPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableSet.AddressSet storage poolTokens = _minimalSwapInfoPoolsTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            bool added = poolTokens.add(address(tokens[i]));
            _require(added, Errors.TOKEN_ALREADY_REGISTERED);
        }
    }

    /**
     * @dev Deregisters a list of tokens in a Minimal Swap Info Pool.
     *
     * Requirements:
     *
     * - Tokens must be registered in the Pool
     * - Tokens must have zero balance in the Vault
     */
    function _deregisterMinimalSwapInfoPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableSet.AddressSet storage poolTokens = _minimalSwapInfoPoolsTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            _require(_minimalSwapInfoPoolsBalances[poolId][token].isZero(), Errors.NONZERO_TOKEN_BALANCE);
            bool removed = poolTokens.remove(address(token));
            // No need to delete the balance entries, since they are already zero
            _require(removed, Errors.TOKEN_NOT_REGISTERED);
        }
    }

    function _setMinimalSwapInfoPoolBalances(
        bytes32 poolId,
        IERC20[] memory tokens,
        bytes32[] memory balances
    ) internal {
        for (uint256 i = 0; i < tokens.length; ++i) {
            _minimalSwapInfoPoolsBalances[poolId][tokens[i]] = balances[i];
        }
    }

    function _minimalSwapInfoPoolCashToManaged(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateMinimalSwapInfoPoolBalance(poolId, token, BalanceAllocation.cashToManaged, amount);
    }

    function _minimalSwapInfoPoolManagedToCash(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateMinimalSwapInfoPoolBalance(poolId, token, BalanceAllocation.managedToCash, amount);
    }

    function _setMinimalSwapInfoPoolManagedBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal returns (int256) {
        return _updateMinimalSwapInfoPoolBalance(poolId, token, BalanceAllocation.setManaged, amount);
    }

    function _updateMinimalSwapInfoPoolBalance(
        bytes32 poolId,
        IERC20 token,
        function(bytes32, uint256) returns (bytes32) mutation,
        uint256 amount
    ) internal returns (int256) {
        bytes32 currentBalance = _getMinimalSwapInfoPoolBalance(poolId, token);
        bytes32 newBalance = mutation(currentBalance, amount);
        _minimalSwapInfoPoolsBalances[poolId][token] = newBalance;
        return newBalance.managedDelta(currentBalance);
    }

    /**
     * @dev Returns an array with all the tokens and balances in a Minimal Swap Info Pool.
     * This order may change when tokens are added to or removed from the Pool.
     */
    function _getMinimalSwapInfoPoolTokens(bytes32 poolId)
        internal
        view
        returns (IERC20[] memory tokens, bytes32[] memory balances)
    {
        EnumerableSet.AddressSet storage poolTokens = _minimalSwapInfoPoolsTokens[poolId];
        tokens = new IERC20[](poolTokens.length());
        balances = new bytes32[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = IERC20(poolTokens.at(i));
            tokens[i] = token;
            balances[i] = _minimalSwapInfoPoolsBalances[poolId][token];
        }
    }

    /**
     * @dev Returns the balance for a token in a Minimal Swap Info Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     */
    function _getMinimalSwapInfoPoolBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        bytes32 balance = _minimalSwapInfoPoolsBalances[poolId][token];
        bool existsToken = balance.isNotZero() || _minimalSwapInfoPoolsTokens[poolId].contains(address(token));

        // If there is no balance for the requested token, we check if the token was registered.
        // This is a gas optimization so that in the happy path where the token is registered to the pool,
        // we don't have to check whether the pool was registered.
        if (!existsToken) {
            // The token might not be registered because the Pool itself is not registered. If so, we provide a more
            // accurate revert reason. We only check this at this stage to save gas in the case where the token
            // is registered, which implies the Pool is as well.
            _ensureRegisteredPool(poolId);
            _revert(Errors.TOKEN_NOT_REGISTERED);
        }

        return balance;
    }

    function _isMinimalSwapInfoPoolTokenRegistered(bytes32 poolId, IERC20 token) internal view returns (bool) {
        EnumerableSet.AddressSet storage poolTokens = _minimalSwapInfoPoolsTokens[poolId];
        return poolTokens.contains(address(token));
    }
}
