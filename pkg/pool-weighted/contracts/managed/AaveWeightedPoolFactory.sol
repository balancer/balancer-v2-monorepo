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

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolFactory.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "@balancer-labs/v2-asset-manager-utils/contracts/AaveATokenAssetManager.sol";

import "../IWeightedPoolFactory.sol";

contract AaveWeightedPoolFactory is BasePoolFactory {
    IWeightedPoolFactory public immutable poolFactory;
    ILendingPool public immutable lendingPool;

    address private constant _REWARDS_DISTRIBUTOR = address(0);

    constructor(IWeightedPoolFactory baseFactory, ILendingPool aaveLendingPool) BasePoolFactory(baseFactory.getVault()) {
        poolFactory = baseFactory;
        lendingPool = aaveLendingPool;
    }

    /**
     * @dev Deploys a new `WeightedPool`.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256[] memory managedTokens,
        uint256 swapFeePercentage,
        address owner,
        IAaveIncentivesController aaveIncentives,
        address rewardsDistributor
    ) external returns (address) {
        // Without an owner the investment config may not be set to invest any funds.
        // We then reject any ownerless pools from this factory.
        require(owner != address(0), "Pool must have owner");

        // Deploy asset manangers for any managed tokens
        address[] memory assetManagers = new address[](tokens.length);
        for (uint256 i; i < managedTokens.length; i++) {
            assetManagers[managedTokens[i]] = address(
                new AaveATokenAssetManager(
                    getVault(),
                    tokens[i],
                    lendingPool,
                    aaveIncentives
                )
            );
        }

        // Deploy weighted pool using created asset managers
        address pool = poolFactory.create(name, symbol, tokens, weights, assetManagers, swapFeePercentage, owner);

        // Initialise asset managers with deployed pool's id
        bytes32 poolId = BasePool(pool).getPoolId();
        for (uint256 i; i < managedTokens.length; i++) {
            AaveATokenAssetManager(assetManagers[managedTokens[i]]).initialize(poolId, rewardsDistributor);
        }

        _register(pool);
        return pool;
    }
}
