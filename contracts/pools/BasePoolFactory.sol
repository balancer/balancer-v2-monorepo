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

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

import "../vault/interfaces/IVault.sol";
import "../vault/interfaces/IPool.sol";

abstract contract BasePoolFactory {
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using Address for address;

    IVault internal immutable _vault;

    // Set with Pools created by this factory
    EnumerableSet.Bytes32Set internal _createdPools;

    event PoolCreated(address indexed pool);

    constructor(IVault vault) {
        _vault = vault;
    }

    function getVault() external view returns (IVault) {
        return _vault;
    }

    function getNumberOfCreatedPools() external view returns (uint256) {
        return _createdPools.length();
    }

    function getCreatedPoolIds(uint256 start, uint256 end) external view returns (bytes32[] memory) {
        require((end >= start) && (end - start) <= _createdPools.length(), "ERR_BAD_INDICES");

        bytes32[] memory poolIds = new bytes32[](end - start);
        for (uint256 i = 0; i < poolIds.length; ++i) {
            poolIds[i] = _createdPools.at(i + start);
        }

        return poolIds;
    }

    /**
     * @dev Deploys a pool contract defined by `creationCode`.
     *
     * The creation code for a Solidity contract can be constructed by concatenating the `creationCode` property of the
     * contract type with the ABI-encoded constructor arguments. Note that the compiler doesn't perform any type
     * checking here: all factory-created contracts should be subject to at least basic testing.
     *
     * Sample usage using abi.encodePacked to concatenate the `bytes` arrays:
     *   _create(abi.encodePacked(type(ERC20).creationCode, abi.encode("My Token", "TKN", 18)));
     *
     * Emits a `PoolCreated` event.
     *
     * Returns the address of the created contract.
     */
    function _create(bytes memory creationCode) internal returns (address) {
        address pool = Create2.deploy(0, bytes32(_createdPools.length()), creationCode);
        bytes32 poolId = IPool(pool).getPoolId();

        bool added = _createdPools.add(poolId);
        require(added, "Repeated Pool ID"); // This should never happen, as the Vault assigns unique IDs

        emit PoolCreated(pool);

        return pool;
    }
}
