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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/IRecoverable.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/BasePoolUserData.sol";

import "../math/FixedPoint.sol";

/**
 * @notice Handle storage and state changes for pools that support "Recovery Mode".
 *
 * @dev This is intended to provide a safe way to exit any pool during some kind of emergency, to avoid locking funds
 * in the event the pool enters a non-functional state (i.e., some code that normally runs during exits is causing
 * them to revert). Pool contracts should provide permissioned functions that call `setRecoveryMode` to enter and
 * exit this state.
 *
 * Recovery Mode is *not* the same as pausing the pool. The pause function is only available during a short window
 * after factory deployment. Pausing can only be intentionally reversed during a buffer period, and the contract
 * will permanently unpause itself thereafter. Paused pools are completely disabled, in a kind of suspended animation,
 * until they are voluntarily or involuntarily unpaused.
 *
 * By contrast, a privileged account - typically a governance multisig - can place a pool in Recovery Mode at any
 * time, and it is always reversible. The pool is *not* disabled while in this mode: though of course whatever
 * condition prompted the transition to Recovery Mode has likely effectively disabled some functions. Rather,
 * a special "clean" exit is enabled, which runs the absolute minimum code necessary to exit proportionally.
 * In particular, stable pools do not attempt to compute the invariant (which is a complex, iterative calculation
 * that can fail in extreme circumstances), and no protocol fees are collected.
 *
 * In some pools, such as those with Oracles or Price Rates, Recovery mode takes advantage of mathematical properties
 * to safely compute the invariant for the special case of proportional withdrawals, without running the usual more
 * complex code necessary in general (e.g., for non-proportional joins/exits and swaps). This might be enough to
 * support functions like `getRate`, allowing dependent pools to function normally. (Otherwise, the dependent pools
 * can themselves be placed into Recovery Mode.)
 *
 * It is critical to ensure that turning on Recovery Mode would do no harm, if activated maliciously or in error.
 */
abstract contract Recoverable is IRecoverable {
    using FixedPoint for uint256;
    using BasePoolUserData for bytes;

    bool private _recoveryMode;

    /**
     * @dev Reverts if the contract is in Recovery Mode.
     */
    modifier whenNotInRecoveryMode() {
        _ensureNotInRecoveryMode();
        _;
    }

    /**
     * @notice Returns whether the pool is in Recovery Mode.
     */
    function inRecoveryMode() public view override returns (bool) {
        return _recoveryMode;
    }

    /**
     * @dev Sets the recoveryMode state, and emits the corresponding event. Can be overridden
     * if a pool needs to detect when the Recovery Mode state changes.
     *
     * No complex code or external calls that could fail should be placed here, which could jeopardize
     * the ability to enter and exit Recovery Mode.
     */
    function _setRecoveryMode(bool recoveryMode) internal virtual {
        _recoveryMode = recoveryMode;

        emit RecoveryModeStateChanged(recoveryMode);
    }

    /**
     * @dev Reverts if the contract is not in Recovery Mode.
     */
    function _ensureInRecoveryMode() internal view {
        _require(_recoveryMode, Errors.NOT_IN_RECOVERY_MODE);
    }

    /**
     * @dev Reverts if the contract is in Recovery Mode.
     */
    function _ensureNotInRecoveryMode() internal view {
        _require(!_recoveryMode, Errors.IN_RECOVERY_MODE);
    }
}
