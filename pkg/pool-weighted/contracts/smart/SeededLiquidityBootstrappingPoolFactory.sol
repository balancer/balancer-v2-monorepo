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

import "./AssetManagedLiquidityBootstrappingPool.sol";

contract SeededLiquidityBootstrappingPoolFactory is BasePoolSplitCodeFactory, FactoryWidePauseWindow {
    constructor(IVault vault)
        BasePoolSplitCodeFactory(vault, type(AssetManagedLiquidityBootstrappingPool).creationCode)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Deploys a new `AssetManagedLiquidityBootstrappingPool`.
     */
    function create(AssetManagedLiquidityBootstrappingPool.NewPoolParams memory poolParams)
        external
        returns (address pool)
    {
        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();

        return
            _create(
                abi.encode(
                    poolParams,
                    getVault(),
                    pauseWindowDuration,
                    bufferPeriodDuration,
                    msg.sender, // manager
                    address(0) // no asset manager
                )
            );
    }
}
