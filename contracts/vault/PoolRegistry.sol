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

import "../lib/helpers/BalancerErrors.sol";
import "../lib/openzeppelin/ReentrancyGuard.sol";

import "./interfaces/IVault.sol";
import "./VaultAuthorization.sol";

abstract contract PoolRegistry is IVault, ReentrancyGuard, VaultAuthorization {
    // This is always used as uint80, but storing as an uint256 results in reduced bytecode due to the lack of masking.
    uint256 private _nextPoolNonce;

    // Pool IDs are stored as `bytes32`.
    mapping(bytes32 => bool) private _isPoolRegistered;

    /**
     * @dev Reverts unless `poolId` corresponds to a registered Pool.
     */
    modifier withRegisteredPool(bytes32 poolId) {
        _ensureRegisteredPool(poolId);
        _;
    }

    /**
     * @dev Reverts unless `poolId` corresponds to a registered Pool, and the caller is the Pool's contract.
     */
    modifier onlyPool(bytes32 poolId) {
        _ensurePoolIsSender(poolId);
        _;
    }

    /**
     * @dev Creates a Pool ID.
     *
     * These are deterministically created by packing into the ID the Pool's contract address and its specialization
     * setting. This saves gas, as these data do not need to be written to or read from storage when interacting with
     * the Pool.
     *
     * Since a single contract can register multiple Pools, a unique nonce must be provided to ensure Pool IDs are
     * unique.
     */
    function _toPoolId(
        address pool,
        PoolSpecialization specialization,
        uint80 nonce
    ) internal pure returns (bytes32) {
        uint256 serialized;

        // | 20 bytes pool address | 2 bytes specialization setting | 10 bytes nonce |
        serialized |= uint256(nonce);
        serialized |= uint256(specialization) << (10 * 8);
        serialized |= uint256(pool) << (12 * 8);

        return bytes32(serialized);
    }

    /**
     * @dev Returns a Pool's address.
     *
     * Due to how Pool IDs are created, this is done with no storage accesses and costs little gas.
     */
    function _getPoolAddress(bytes32 poolId) internal pure returns (address) {
        // | 20 bytes pool address | 2 bytes specialization setting | 10 bytes nonce |
        return address((uint256(poolId) >> (12 * 8)) & (2**(20 * 8) - 1));
    }

    /**
     * @dev Returns a Pool's specialization setting.
     *
     * Due to how Pool IDs are created, this is done with no storage accesses and costs little gas.
     */
    function _getPoolSpecialization(bytes32 poolId) internal pure returns (PoolSpecialization) {
        // | 20 bytes pool address | 2 bytes specialization setting | 10 bytes nonce |
        return PoolSpecialization(uint256(poolId >> (10 * 8)) & (2**(2 * 8) - 1));
    }

    function registerPool(PoolSpecialization specialization)
        external
        override
        nonReentrant
        noEmergencyPeriod
        returns (bytes32)
    {
        // Each Pool is assigned an ID based on an incrementing nonce. This assumes there will never be more than 2**80
        // Pools.

        bytes32 poolId = _toPoolId(msg.sender, specialization, uint80(_nextPoolNonce));
        _require(!_isPoolRegistered[poolId], Errors.INVALID_POOL_ID); // Should never happen

        _nextPoolNonce += 1;
        _isPoolRegistered[poolId] = true;

        emit PoolRegistered(poolId);
        return poolId;
    }

    /**
     * @dev Reverts unless `poolId` corresponds to a registered Pool.
     */
    function _ensureRegisteredPool(bytes32 poolId) internal view {
        _require(_isPoolRegistered[poolId], Errors.INVALID_POOL_ID);
    }

    /**
     * @dev Reverts unless `poolId` corresponds to a registered Pool, and the caller is the Pool's contract.
     */
    function _ensurePoolIsSender(bytes32 poolId) private view {
        _ensureRegisteredPool(poolId);
        address pool = _getPoolAddress(poolId);
        _require(pool == msg.sender, Errors.CALLER_NOT_POOL);
    }
}
