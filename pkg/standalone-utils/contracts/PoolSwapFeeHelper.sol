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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IPoolSwapFeeHelper.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/OwnableAuthentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";

/// @notice Common code for helper functions that operate on a subset of pools.
abstract contract PoolSwapFeeHelper is IPoolSwapFeeHelper, OwnableAuthentication {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // Counter for generating unique pool set IDs. Must start at 1, since 0 is defined as invalid.
    uint256 private _nextPoolSetId = 1;

    // Mapping from pool set ID to the manager address.
    mapping(uint256 => address) private _poolSetManagers;

    // Reverse lookup to find which set a given manager owns. Mapping from the manager to a pool set id.
    // Note that this means an address may only control a single pool set.
    mapping(address => uint256) private _poolSetLookup;

    // Mapping from a pool set ID to the set of pool ids in that pool set.
    mapping(uint256 => EnumerableSet.Bytes32Set) private _poolSets;

    // Ensure the explicit poolSetId (used in the admin interface) is valid.
    modifier withValidPoolSet(uint256 poolSetId) {
        _ensureValidPoolSet(poolSetId);
        _;
    }

    // Ensure the pool is in a set controlled by the caller. This is used in derived contracts.
    modifier withValidPoolForSender(bytes32 poolId) {
        uint256 poolSetId = _getValidPoolSetId();
        _ensurePoolInSet(poolSetId, poolId);
        _;
    }

    // Ensure the manager is non-zero, and not already a manager of another set.
    modifier withValidManager(address manager) {
        _ensureValidManager(manager);
        _;
    }

    constructor(IVault vault, address initialOwner) OwnableAuthentication(vault, initialOwner) {
        // solhint-disable-previous-line no-empty-blocks
    }

    /***************************************************************************
                                 Manage Pool Sets
    ***************************************************************************/

    /// @inheritdoc IPoolSwapFeeHelper
    function createPoolSet(
        address initialManager
    ) external override onlyOwner withValidManager(initialManager) returns (uint256) {
        return _createPoolSet(initialManager);
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function createPoolSet(
        address initialManager,
        bytes32[] memory newPoolIds
    ) external override onlyOwner withValidManager(initialManager) returns (uint256 poolSetId) {
        poolSetId = _createPoolSet(initialManager);

        if (newPoolIds.length > 0) {
            addPoolsToSet(poolSetId, newPoolIds);
        }
    }

    function _createPoolSet(address initialManager) internal returns (uint256 poolSetId) {
        poolSetId = _nextPoolSetId++;

        // Add to forward and reverse mappings.
        _poolSetManagers[poolSetId] = initialManager;
        _poolSetLookup[initialManager] = poolSetId;

        emit PoolSetCreated(poolSetId, initialManager);
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function destroyPoolSet(uint256 poolSetId) external override onlyOwner withValidPoolSet(poolSetId) {
        EnumerableSet.Bytes32Set storage poolSet = _poolSets[poolSetId];

        // Remove all pools from the set.
        uint256 numPools = poolSet.length();

        while (numPools > 0) {
            --numPools;

            bytes32 poolId = poolSet.at(numPools);
            emit PoolRemovedFromSet(poolId, poolSetId);

            poolSet.remove(poolId);
        }

        // Remove the set itself.
        delete _poolSets[poolSetId];

        address manager = _poolSetManagers[poolSetId];

        // Also remove associated manager from both mappings.
        _poolSetManagers[poolSetId] = address(0);
        _poolSetLookup[manager] = 0;

        emit PoolSetDestroyed(poolSetId, manager);
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function transferPoolSetOwnership(address newManager) external override withValidManager(newManager) {
        uint256 poolSetId = _getValidPoolSetId();

        _poolSetManagers[poolSetId] = newManager;

        // The "old" manager must be the current sender.
        _poolSetLookup[msg.sender] = 0;
        _poolSetLookup[newManager] = poolSetId;

        emit PoolSetOwnershipTransferred(poolSetId, msg.sender, newManager);
    }

    /***************************************************************************
                                   Manage Pools
    ***************************************************************************/

    /// @inheritdoc IPoolSwapFeeHelper
    function addPoolsToSet(uint256 poolSetId, bytes32[] memory newPoolIds) public override onlyOwner withValidPoolSet(poolSetId) {
        uint256 numPools = newPoolIds.length;

        for (uint256 i = 0; i < numPools; i++) {
            bytes32 poolId = newPoolIds[i];

            // Will revert with INVALID_POOL_ID if not a valid pool id.
            vault.getPool(poolId);

            bool addResult = _poolSets[poolSetId].add(poolId);
            _require(addResult, Errors.POOL_ALREADY_IN_SET);

            emit PoolAddedToSet(poolId, poolSetId);
        }
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function removePoolsFromSet(
        uint256 poolSetId,
        bytes32[] memory poolIds
    ) public override onlyOwner withValidPoolSet(poolSetId) {
        uint256 numPools = poolIds.length;

        for (uint256 i = 0; i < numPools; i++) {
            bytes32 poolId = poolIds[i];

            bool removeResult = _poolSets[poolSetId].remove(poolId);
            _require(removeResult, Errors.POOL_NOT_IN_SET);

            emit PoolRemovedFromSet(poolId, poolSetId);
        }
    }

    /***************************************************************************
                                    Getters                                
    ***************************************************************************/

    /// @inheritdoc IPoolSwapFeeHelper
    function getPoolSetIdForCaller() public view override returns (uint256) {
        return _poolSetLookup[msg.sender];
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function getPoolSetIdForManager(address manager) public view override returns (uint256) {
        return _poolSetLookup[manager];
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function getPoolCountForSet(uint256 poolSetId) external view override withValidPoolSet(poolSetId) returns (uint256) {
        return _poolSets[poolSetId].length();
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function isValidPoolSetId(uint256 poolSetId) external view override returns (bool) {
        return _poolSetManagers[poolSetId] != address(0);
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function isPoolInSet(bytes32 poolId, uint256 poolSetId) external view override withValidPoolSet(poolSetId) returns (bool) {
        return _poolSets[poolSetId].contains(poolId);
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function getAllPoolsInSet(
        uint256 poolSetId
    ) external view override withValidPoolSet(poolSetId) returns (bytes32[] memory poolIds) {
        return _getPoolsInRange(poolSetId, 0, _poolSets[poolSetId].length());
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function getPoolsInSet(
        uint256 poolSetId,
        uint256 from,
        uint256 to
    ) public view override withValidPoolSet(poolSetId) returns (bytes32[] memory) {
        return _getPoolsInRange(poolSetId, from, to);
    }

    function _getPoolsInRange(uint256 poolSetId, uint256 from, uint256 to) internal view returns (bytes32[] memory poolIds) {
        uint256 spanLength = _poolSets[poolSetId].length();

        _require(from <= to && to <= spanLength && from < spanLength, Errors.OUT_OF_BOUNDS);

        poolIds = new bytes32[](to - from);
        for (uint256 i = from; i < to; i++) {
            poolIds[i - from] = _poolSets[poolSetId].at(i);
        }
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function getNextPoolSetId() external view override returns (uint256) {
        return _nextPoolSetId;
    }

    /// @inheritdoc IPoolSwapFeeHelper
    function getManagerForPoolSet(uint256 poolSetId) external view override returns (address) {
        return _poolSetManagers[poolSetId];
    }

    /***************************************************************************
                                Internal functions                                
    ***************************************************************************/

    // Find and validate the poolSetId for the caller.
    function _getValidPoolSetId() internal view returns (uint256 poolSetId) {
        poolSetId = getPoolSetIdForCaller();

        _require(poolSetId != 0, Errors.SENDER_NOT_POOL_SET_MANAGER);
    }

    function _ensureValidManager(address manager) internal view {
        _require(manager != address(0), Errors.INVALID_POOL_SET_MANAGER);
        _require(_poolSetLookup[manager] == 0, Errors.POOL_SET_MANAGER_NOT_UNIQUE);
    }

    function _ensurePoolInSet(uint256 poolSetId, bytes32 poolId) internal view {
        _require(_poolSets[poolSetId].contains(poolId), Errors.POOL_NOT_IN_SET);
    }

    function _ensureValidPoolSet(uint256 poolSetId) internal view {
        _require(poolSetId != 0 && _poolSetManagers[poolSetId] != address(0), Errors.INVALID_POOL_SET_ID);
    }

    /***************************************************************************
                                    Manage Pools
    ***************************************************************************/

    /// @inheritdoc IPoolSwapFeeHelper
    function setSwapFeePercentage(bytes32 poolId, uint256 swapFeePercentage) public override withValidPoolForSender(poolId) {
        (address pool, ) = vault.getPool(poolId);

        BasePool(pool).setSwapFeePercentage(swapFeePercentage);
    }
}
