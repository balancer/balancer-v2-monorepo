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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/MinimalCodeDeployer.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

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

    constructor(IVault vault, bytes memory creationCode) {
        _vault = vault;

        // We are going to deploy two contracts: one with the approximately the first half of `creationCode`'s contents
        // (A), and another with the remaining half (B).
        uint256 creationCodeSize = creationCode.length;

        // We store the lengths in both immutable and stack variables as immutable variables cannot be read during
        // construction.
        uint256 creationCodeSizeA = creationCodeSize / 2;
        _creationCodeSizeA = creationCodeSizeA;

        uint256 creationCodeSizeB = creationCodeSize - creationCodeSizeA;
        _creationCodeSizeB = creationCodeSizeB;

        // To deploy the contracts, we're going to use `MinimalCodeDeployer.deploy()`, which expects a memory array with
        // the code to deploy. Note that we cannot simply copy or move `creationCode`'s contents as they are expected to
        // be very large (> 24kB), so we must operate in-place.

        // Creating A's array is simple: we simply replace `creactionCode`'s original length with A's length.

        bytes memory creationCodeA;
        assembly {
            creationCodeA := creationCode
            mstore(creationCodeA, creationCodeSizeA)
        }
        _creationCodeStorageA = MinimalCodeDeployer.deploy(creationCodeA);

        // Creating B's array is similar: since we cannot move B's contents around in memory, we are going to create a
        // 'new' memory array starting at A's last 32 bytes, which will be replaced with B's length. We'll back-up this
        // last byte to later restore it.

        bytes memory creationCodeB;
        bytes32 lastByteA;

        assembly {
            // `creationCode` points to the array's length, not data, so by adding A's length to it we arrive at A's
            // last 32 bytes.
            creationCodeB := add(creationCode, creationCodeSizeA)
            lastByteA := mload(creationCodeB)
            mstore(creationCodeB, creationCodeSizeB)
        }
        _creationCodeStorageB = MinimalCodeDeployer.deploy(creationCodeB);

        // We now restore the original contents of `creationCode` by writing back the original length and A's last byte.
        assembly {
            mstore(creationCodeA, creationCodeSize)
            mstore(creationCodeB, lastByteA)
        }
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
