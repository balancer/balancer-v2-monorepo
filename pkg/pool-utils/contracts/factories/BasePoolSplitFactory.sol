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

import "./CodeDeployer.sol";

/**
 * @dev Same as `BasePoolFactory`, for contracts whose creation code is so large that the factory cannot hold it. This
 * happens when the creation code grows close to 24kB.
 *
 * Note that this factory cannot help with contracts that hava a *runtime* code larger than 24kB.
 */
abstract contract BasePoolSplitFactory {
    IVault private immutable _vault;
    mapping(address => bool) private _isPoolFromFactory;

    address private immutable _creationCodeStorageA;
    uint256 private immutable _creationCodeSizeA;

    address private immutable _creationCodeStorageB;
    uint256 private immutable _creationCodeSizeB;

    event PoolCreated(address indexed pool);

    constructor(IVault vault, bytes calldata poolCreationCode) {
        _vault = vault;

        uint256 creationCodeSize = poolCreationCode.length;

        uint256 creationCodeSizeA = creationCodeSize / 2;
        _creationCodeStorageA = address(new CodeDeployer(poolCreationCode[:creationCodeSizeA]));

        uint256 creationCodeSizeB = creationCodeSize - creationCodeSizeA;
        _creationCodeStorageA = address(new CodeDeployer(poolCreationCode[creationCodeSizeB:]));

        _creationCodeSizeA = creationCodeSizeA;
        _creationCodeSizeB = creationCodeSizeB;
    }

    /**
     * @dev Returns the Vault's address.
     */
    function getVault() public view returns (IVault) {
        return _vault;
    }

    /**
     * @dev Returns true if `pool` was created by this factory.
     */
    function isPoolFromFactory(address pool) external view returns (bool) {
        return _isPoolFromFactory[pool];
    }

    /**
     * @dev Registers a new created pool.
     *
     * Emits a `PoolCreated` event.
     */
    function _register(address pool) internal {
        _isPoolFromFactory[pool] = true;
        emit PoolCreated(pool);
    }
}
