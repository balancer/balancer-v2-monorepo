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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";

import "./BalanceAllocation.sol";
import "../PoolRegistry.sol";

abstract contract MinimalSwapInfoPoolsBalance is PoolRegistry {
    using BalanceAllocation for bytes32;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Data for Pools with the Minimal Swap Info specialization setting
    //
    // These Pools use the IMinimalSwapInfoPool interface, and so the Vault must read the balance of the two tokens
    // in the swap. The best solution is to use a mapping from token to balance, which lets us read or write any token's
    // balance in a single storage access.
    //
    // We also keep a set of registered tokens. Because tokens with non-zero balance are by definition registered, in
    // some balance getters we skip checking for token registration if a non-zero balance is found, saving gas by
    // performing a single read instead of two.

    mapping(bytes32 => mapping(IERC20 => bytes32)) internal _minimalSwapInfoPoolsBalances;
    mapping(bytes32 => EnumerableSet.AddressSet) internal _minimalSwapInfoPoolsTokens;

    /**
     * @dev Registers a list of tokens in a Minimal Swap Info Pool.
     *
     * This function assumes `poolId` exists and corresponds to the Minimal Swap Info specialization setting.
     *
     * Requirements:
     *
     * - `tokens` must not be registered in the Pool
     * - `tokens` must not contain duplicates
     */
    function _registerMinimalSwapInfoPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableSet.AddressSet storage poolTokens = _minimalSwapInfoPoolsTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            bool added = poolTokens.add(address(tokens[i]));
            _require(added, Errors.TOKEN_ALREADY_REGISTERED);
            // Note that we don't initialize the balance mapping: the default value of zero corresponds to an empty
            // balance.
        }
    }

    /**
     * @dev Deregisters a list of tokens in a Minimal Swap Info Pool.
     *
     * This function assumes `poolId` exists and corresponds to the Minimal Swap Info specialization setting.
     *
     * Requirements:
     *
     * - `tokens` must be registered in the Pool
     * - `tokens` must have zero balance in the Vault
     * - `tokens` must not contain duplicates
     */
    function _deregisterMinimalSwapInfoPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        EnumerableSet.AddressSet storage poolTokens = _minimalSwapInfoPoolsTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            _require(_minimalSwapInfoPoolsBalances[poolId][token].isZero(), Errors.NONZERO_TOKEN_BALANCE);

            // For consistency with other Pool specialization settings, we explicitly reset the balance (which may have
            // a non-zero last change block).
            delete _minimalSwapInfoPoolsBalances[poolId][token];

            bool removed = poolTokens.remove(address(token));
            _require(removed, Errors.TOKEN_NOT_REGISTERED);
        }
    }

    /**
     * @dev Sets the balances of a Minimal Swap Info Pool's tokens to `balances`.
     *
     * WARNING: this assumes `balances` has the same length and order as the Pool's tokens.
     */
    function _setMinimalSwapInfoPoolBalances(
        bytes32 poolId,
        IERC20[] memory tokens,
        bytes32[] memory balances
    ) internal {
        for (uint256 i = 0; i < tokens.length; ++i) {
            _minimalSwapInfoPoolsBalances[poolId][tokens[i]] = balances[i];
        }
    }

    /**
     * @dev Transforms `amount` of `token`'s balance in a Minimal Swap Info Pool from cash into managed.
     *
     * This function assumes `poolId` exists, corresponds to the Minimal Swap Info specialization setting, and that
     * `token` is registered for that Pool.
     */
    function _minimalSwapInfoPoolCashToManaged(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateMinimalSwapInfoPoolBalance(poolId, token, BalanceAllocation.cashToManaged, amount);
    }

    /**
     * @dev Transforms `amount` of `token`'s balance in a Minimal Swap Info Pool from managed into cash.
     *
     * This function assumes `poolId` exists, corresponds to the Minimal Swap Info specialization setting, and that
     * `token` is registered for that Pool.
     */
    function _minimalSwapInfoPoolManagedToCash(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateMinimalSwapInfoPoolBalance(poolId, token, BalanceAllocation.managedToCash, amount);
    }

    /**
     * @dev Sets `token`'s managed balance in a Minimal Swap Info Pool to `amount`.
     *
     * This function assumes `poolId` exists, corresponds to the Minimal Swap Info specialization setting, and that
     * `token` is registered for that Pool.
     *
     * Returns the managed balance delta as a result of this call.
     */
    function _setMinimalSwapInfoPoolManagedBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal returns (int256) {
        return _updateMinimalSwapInfoPoolBalance(poolId, token, BalanceAllocation.setManaged, amount);
    }

    /**
     * @dev Sets `token`'s balance in a Minimal Swap Info Pool to the result of the `mutation` function when called with
     * the current balance and `amount`.
     *
     * This function assumes `poolId` exists, corresponds to the Minimal Swap Info specialization setting, and that
     * `token` is registered for that Pool.
     *
     * Returns the managed balance delta as a result of this call.
     */
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
     * @dev Returns an array with all the tokens and balances in a Minimal Swap Info Pool. The order may change when
     * tokens are registered or deregistered.
     *
     * This function assumes `poolId` exists and corresponds to the Minimal Swap Info specialization setting.
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
            // Because the iteration is bounded by `tokens.length`, which matches the EnumerableSet's length, we can use
            // `unchecked_at` as we know `i` is a valid token index, saving storage reads.
            IERC20 token = IERC20(poolTokens.unchecked_at(i));
            tokens[i] = token;
            balances[i] = _minimalSwapInfoPoolsBalances[poolId][token];
        }
    }

    /**
     * @dev Returns the balance of a token in a Minimal Swap Info Pool.
     *
     * Requirements:
     *
     * - `poolId` must be a Minimal Swap Info Pool
     * - `token` must be registered in the Pool
     */
    function _getMinimalSwapInfoPoolBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        bytes32 balance = _minimalSwapInfoPoolsBalances[poolId][token];

        // A non-zero balance guarantees that the token is registered. If zero, we manually check if the token is
        // registered in the Pool. Token registration implies that the Pool is registered as well, which lets us save
        // gas by not performing the check.
        bool tokenRegistered = balance.isNotZero() || _minimalSwapInfoPoolsTokens[poolId].contains(address(token));

        if (!tokenRegistered) {
            // The token might not be registered because the Pool itself is not registered. We check this to provide a
            // more accurate revert reason.
            _ensureRegisteredPool(poolId);
            _revert(Errors.TOKEN_NOT_REGISTERED);
        }

        return balance;
    }

    /**
     * @dev Returns true if `token` is registered in a Minimal Swap Info Pool.
     *
     * This function assumes `poolId` exists and corresponds to the Minimal Swap Info specialization setting.
     */
    function _isMinimalSwapInfoPoolTokenRegistered(bytes32 poolId, IERC20 token) internal view returns (bool) {
        EnumerableSet.AddressSet storage poolTokens = _minimalSwapInfoPoolsTokens[poolId];
        return poolTokens.contains(address(token));
    }
}
