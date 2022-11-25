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

import "@balancer-labs/v2-pool-utils/contracts/controllers/ManagedPoolController.sol";

import "./ManagedPoolFactory.sol";

/**
 * @dev Deploys a new `ManagedPool` owned by a ManagedPoolController with the specified rights.
 * It uses the ManagedPoolFactory to deploy the pool.
 */
contract ControlledManagedPoolFactory {
    // The address of the ManagedPoolFactory used to deploy the ManagedPool
    address public immutable managedPoolFactory;

    mapping(address => bool) private _isPoolFromFactory;

    event ManagedPoolCreated(address indexed pool, address indexed poolController);

    constructor(address factory) {
        managedPoolFactory = factory;
    }

    /**
     * @dev Deploys a new `ManagedPool`.
     */
    function create(
        ManagedPoolSettings.NewPoolParams memory poolParams,
        BasePoolController.BasePoolRights calldata basePoolRights,
        ManagedPoolController.ManagedPoolRights calldata managedPoolRights,
        uint256 minWeightChangeDuration,
        address manager
    ) external returns (address pool) {
        ManagedPoolController poolController = new ManagedPoolController(
            basePoolRights,
            managedPoolRights,
            minWeightChangeDuration,
            manager
        );

        // Let the base factory deploy the pool (owner is the controller)
        pool = ManagedPoolFactory(managedPoolFactory).create(poolParams, address(poolController));

        // Finally, initialize the controller
        poolController.initialize(pool);

        _isPoolFromFactory[pool] = true;
        emit ManagedPoolCreated(pool, address(poolController));
    }

    /**
     * @dev Returns true if `pool` was created by this factory.
     */
    function isPoolFromFactory(address pool) external view returns (bool) {
        return _isPoolFromFactory[pool];
    }
}
