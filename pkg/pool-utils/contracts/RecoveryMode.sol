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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/BasePoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRecoveryMode.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "./BasePoolAuthorization.sol";

/**
 * @notice Handle storage and state changes for pools that support "Recovery Mode".
 *
 * @dev This is intended to provide a safe way to exit any pool during some kind of emergency, to avoid locking funds
 * in the event the pool enters a non-functional state (i.e., some code that normally runs during exits is causing
 * them to revert).
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
 * It is critical to ensure that turning on Recovery Mode would do no harm, if activated maliciously or in error.
 */
abstract contract RecoveryMode is IRecoveryMode, BasePoolAuthorization {
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
     * @notice Enable recovery mode, which enables a special safe exit path for LPs.
     * @dev Does not otherwise affect pool operations (beyond deferring payment of protocol fees), though some pools may
     * perform certain operations in a "safer" manner that is less likely to fail, in an attempt to keep the pool
     * running, even in a pathological state. Unlike the Pause operation, which is only available during a short window
     * after factory deployment, Recovery Mode can always be enableed.
     */
    function enableRecoveryMode() external override authenticate {
        _setRecoveryMode(true);
    }

    /**
     * @notice Disable recovery mode, which disables the special safe exit path for LPs.
     * @dev Protocol fees are not paid while in Recovery Mode, so it should only remain active for as long as strictly
     * necessary.
     */
    function disableRecoveryMode() external override authenticate {
        _setRecoveryMode(false);
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
     * the ability to enable and disable Recovery Mode.
     */
    function _setRecoveryMode(bool enabled) internal virtual {
        _recoveryMode = enabled;

        emit RecoveryModeStateChanged(enabled);
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

    /**
     * @dev A minimal proportional exit, suitable as is for most pools: though not for pools with Phantom BPT
     * or other special considerations. Designed to be overridden if a pool needs to do extra processing,
     * such as scaling a stored invariant, or caching the new total supply.
     *
     * No complex code or external calls should be made in derived contracts that override this!
     */
    function _doRecoveryModeExit(
        uint256[] memory balances,
        uint256 totalSupply,
        bytes memory userData
    ) internal virtual returns (uint256, uint256[] memory) {
        uint256 bptAmountIn = userData.recoveryModeExit();

        uint256[] memory amountsOut = _computeProportionalAmountsOut(balances, totalSupply, bptAmountIn);

        return (bptAmountIn, amountsOut);
    }

    function _computeProportionalAmountsOut(
        uint256[] memory balances,
        uint256 totalSupply,
        uint256 bptAmountIn
    ) internal pure returns (uint256[] memory amountsOut) {
        /**********************************************************************************************
        // exactBPTInForTokensOut                                                                    //
        // (per token)                                                                               //
        // aO = tokenAmountOut             /        bptIn         \                                  //
        // b = tokenBalance      a0 = b * | ---------------------  |                                 //
        // bptIn = bptAmountIn             \     bptTotalSupply    /                                 //
        // bpt = bptTotalSupply                                                                      //
        **********************************************************************************************/

        // Since we're computing an amount out, we round down overall. This means rounding down on both the
        // multiplication and division.

        uint256 bptRatio = bptAmountIn.divDown(totalSupply);

        amountsOut = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            amountsOut[i] = balances[i].mulDown(bptRatio);
        }
    }
}
