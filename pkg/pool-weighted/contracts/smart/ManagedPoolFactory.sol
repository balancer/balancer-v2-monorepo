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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolSplitCodeFactory.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/FactoryWidePauseWindow.sol";
import "@balancer-labs/v2-pool-utils/contracts/controllers/ManagedPoolController.sol";

import "./ManagedPool.sol";

/**
 * @dev Deploys a new `ManagedPool`. Supports asset managers, and deploys a ManagedPoolController as the owner.
 */
contract ManagedPoolFactory is BasePoolSplitCodeFactory, FactoryWidePauseWindow {
    constructor(IVault vault) BasePoolSplitCodeFactory(vault, type(ManagedPool).creationCode) {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Deploys a new `ManagedPool`.
     */
    function create(
        ManagedPool.NewPoolParams calldata poolParams,
        BasePoolController.BasePoolRights calldata basePoolRights,
        ManagedPoolController.ManagedPoolRights calldata managedPoolRights,
        uint256 minWeightChangeDuration
    ) external returns (address pool) {
        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();

        ManagedPoolController poolController = new ManagedPoolController(
            basePoolRights,
            managedPoolRights,
            minWeightChangeDuration,
            msg.sender
        );

        pool = _create(
            abi.encode(
                ManagedPool.NewPoolParams({
                    vault: getVault(),
                    name: poolParams.name,
                    symbol: poolParams.symbol,
                    tokens: poolParams.tokens,
                    normalizedWeights: poolParams.normalizedWeights,
                    assetManagers: poolParams.assetManagers,
                    swapFeePercentage: poolParams.swapFeePercentage,
                    pauseWindowDuration: pauseWindowDuration,
                    bufferPeriodDuration: bufferPeriodDuration,
                    owner: address(poolController),
                    swapEnabledOnStart: poolParams.swapEnabledOnStart,
                    mustAllowlistLPs: poolParams.mustAllowlistLPs,
                    managementSwapFeePercentage: poolParams.managementSwapFeePercentage
                })
            )
        );

        poolController.initialize(pool);
    }
}
