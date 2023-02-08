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

/**
 * @notice Performs a read-only reentrancy attack on a target linear pool, making use of the `receive` callback hook
 * in the middle of an exit operation.
 */
contract ReadOnlyReentrancyAttackerLP {
    enum AttackType { SET_TARGETS, SET_SWAP_FEE }

    uint8 public constant RECOVERY_MODE_EXIT_KIND = 255;

    IVault private immutable _vault;
    AttackType private _attackType;
    bytes32 private _poolId;

    constructor(IVault vault) {
        _vault = vault;
    }

    /**
     * @dev Starts attack on target pool. Since LinearPool attacks can only be called by the owner,
     * and regular joins and exits are disabled, the attacker contract must be the owner, and the only
     * way to enter the Vault context is a RecoveryMode exit.
     *
     * This function must be called with the pool in Recovery Mode.
     *
     * @param poolId Pool ID to attack.
     * @param attackType Type of attack; determines which vulnerable pool function to call.
     */
    function startAttack(
        bytes32 poolId,
        AttackType attackType,
        uint256 bptAmountIn
    ) external payable {
        _attackType = attackType;
        _poolId = poolId;
        IVault vault = _vault;

        bytes memory userData = abi.encode(RECOVERY_MODE_EXIT_KIND, bptAmountIn);
        (IERC20[] memory tokens, ,) = vault.getPoolTokens(poolId);

        IVault.ExitPoolRequest memory exitPoolRequest = IVault.ExitPoolRequest(
            _asIAsset(tokens),
            new uint256[](tokens.length),
            userData,
            false
        );

        vault.exitPool(poolId, address(this), address(this), exitPoolRequest);
    }

    receive() external payable {
        _reenterAttack();
    }

    function _reenterAttack() internal {
        AttackType attackType = _attackType;
        (address pool, ) = _vault.getPool(_poolId);

        if (attackType == AttackType.SET_TARGETS) {
            (uint256 lowerTarget, uint256 upperTarget) = ILinearPool(pool).getTargets();
            ILinearPool(pool).setTargets(lowerTarget, upperTarget);
        } else if (attackType == AttackType.SET_SWAP_FEE) {
            uint256 swapFeePercentage = ILinearPool(pool).getSwapFeePercentage();
            ILinearPool(pool).setSwapFeePercentage(swapFeePercentage);
        }
    }

    function _asIAsset(IERC20[] memory tokens) private pure returns (IAsset[] memory assets) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            assets := tokens
        }
    }
}
