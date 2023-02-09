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
 * @notice Performs a read-only reentrancy attack on a target linear pool, making use of the `receive` callback hook
 * in the middle of an exit operation.
 */
contract ReadOnlyReentrancyAttackerLP {
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
     * @dev Starts attack on target pool. Since LinearPool regular joins and exits are disabled, the attacker contract
     * must use RecoveryMode exit to perform the attack in a Vault context.
     *
     * The pool must have WETH, and the exit request must include the sentinel value (`address(0)`) so that the vault
     * unwraps the token on the way out, effectively triggering the `receive` callback in this contract.
     *
     * Finally, the attacker needs to have permission to call the target functions (`setTargets` and
     * `setSwapFeePercentage`) before the attack starts.
     *
     * @param pool Pool to attack.
     * @param attackType Type of attack; determines which vulnerable pool function to call.
     * @param bptAmountIn Amount of BPT to exit with (exchanged for WETH, unwrapped to ETH)
     */
    function startAttack(
        ILinearPool pool,
        AttackType attackType,
        uint256 bptAmountIn
    ) external payable {
        _attackType = attackType;
        _pool = pool;
        IVault vault = _vault;
        IERC20 weth = vault.WETH();
        bytes32 poolId = pool.getPoolId();

        bytes memory userData = abi.encode(RECOVERY_MODE_EXIT_KIND, bptAmountIn);
        (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);

        uint256 i = 0;
        for (i = 0; i < tokens.length; ++i) {
            if (tokens[i] == weth) {
                tokens[i] = IERC20(address(0)); // This is the sentinel value to unwrap WETH.
                break;
            }
        }
        require(i < tokens.length, "Pool does not contain WETH");

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
        ILinearPool pool = _pool;

        if (attackType == AttackType.SET_TARGETS) {
            pool.setTargets(_LOWER_TARGET, _UPPER_TARGET);
        } else if (attackType == AttackType.SET_SWAP_FEE) {
            pool.setSwapFeePercentage(_SWAP_FEE_PERCENTAGE);
        }
    }
}
