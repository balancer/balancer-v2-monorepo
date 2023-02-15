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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-linear/ILinearPool.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

/**
 * @notice Performs a read-only reentrancy attack on a target linear pool, making use of the `receive` hook
 * in the middle of a Vault operation.
 */
contract ReadOnlyReentrancyAttackerEP {
    using FixedPoint for uint256;

    enum AttackType { SET_TARGETS, SET_SWAP_FEE }

    uint8 public constant RECOVERY_MODE_EXIT_KIND = 255;

    uint256 private constant _LOWER_TARGET = 20e18;
    uint256 private constant _UPPER_TARGET = 500e18;
    uint256 private constant _SWAP_FEE_PERCENTAGE = 1e16;

    IVault private immutable _vault;
    AttackType private _attackType;
    ILinearPool private _pool;

    constructor(IVault vault) {
        _vault = vault;
    }

    /**
     * @dev Starts attack on target pool. Since LinearPool attacks can only be called by the owner,
     * and regular joins and exits are disabled, the attacker contract must be the owner.
     *
     * It is possible to enter the Vault with a RecoveryMode exit, but in order to trigger the callback,
     * the pool token must be WETH, so that we can request the Vault to unwrap to ETH by passing in the
     * sentinel value for ETH (0), instead of the address of WETH.
     *
     * Since WETH is not an "underlying" Euler token, trying to create a pool with WETH will fail with
     * TOKENS_MISMATCH, so we really cannot perform the WETH attack on this pool (i.e., technically it's
     * not vulnerable at present: but theoretically could become so in the future if a WETH-compatible
     * toekn were added). For completeness, we verify that it inherits reentrancy protection from base
     * LinearPool.
     *
     * Though we cannot do an exit with ETH, if you do an internal balance deposit of ETH, it will enter
     * the Vault through user balance, and trigger the callback. This isn't a practical attack (nothing
     * will be out of sync in the pool during it), but it verifies the reentrancy protection.
     *
     * @param pool Pool to attack.
     * @param attackType Type of attack; determines which vulnerable pool function to call.
     * @param ethAmount Amount of ETH to deposit
     */
    function startAttack(
        ILinearPool pool,
        AttackType attackType,
        uint256 ethAmount
    ) external payable {
        _attackType = attackType;
        _pool = pool;

        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);
        ops[0].kind = IVault.UserBalanceOpKind.DEPOSIT_INTERNAL;
        // asset defaults to 0 (ETH sentinel value)
        ops[0].amount = ethAmount;
        ops[0].sender = address(this);
        ops[0].recipient = payable(address(this));

        _vault.manageUserBalance{ value: msg.value }(ops);
    }

    receive() external payable {
        _reenterAttack();
    }

    function _reenterAttack() internal {
        AttackType attackType = _attackType;
        ILinearPool pool = _pool;

        if (attackType == AttackType.SET_TARGETS) {
            pool.setTargets(_LOWER_TARGET, _UPPER_TARGET);
        } else if (attackType == AttackType.SET_SWAP_FEE) {
            pool.setSwapFeePercentage(_SWAP_FEE_PERCENTAGE);
        }
    }
}
