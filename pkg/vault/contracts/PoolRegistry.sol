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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "./VaultAuthorization.sol";

/**
 * @dev Maintains the Pool ID data structure, implements Pool ID creation and registration, and defines useful modifiers
 * and helper functions for ensuring correct behavior when working with Pools.
 */
abstract contract PoolRegistry is ReentrancyGuard, VaultAuthorization {
    // Each pool is represented by their unique Pool ID. We use `bytes32` for them, for lack of a way to define new
    // types.
    mapping(bytes32 => bool) private _isPoolRegistered;

    // We keep an increasing nonce to make Pool IDs unique. It is interpreted as a `uint80`, but storing it as a
    // `uint256` results in reduced bytecode on reads and writes due to the lack of masking.
    uint256 private _nextPoolNonce;

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
        _require(msg.sender == _getPoolAddress(poolId), Errors.CALLER_NOT_POOL);
    }

    function registerPool(PoolSpecialization specialization)
        external
        override
        nonReentrant
        whenNotPaused
        returns (bytes32)
    {
        // Each Pool is assigned a unique ID based on an incrementing nonce. This assumes there will never be more than
        // 2**80 Pools, and the nonce will not overflow.

        bytes32 poolId = _toPoolId(msg.sender, specialization, uint80(_nextPoolNonce));

        _require(!_isPoolRegistered[poolId], Errors.INVALID_POOL_ID); // Should never happen as Pool IDs are unique.
        _isPoolRegistered[poolId] = true;

        _nextPoolNonce += 1;

        // Note that msg.sender is the pool's contract
        emit PoolRegistered(poolId, msg.sender, specialization);
        return poolId;
    }

    function getPool(bytes32 poolId)
        external
        view
        override
        withRegisteredPool(poolId)
        returns (address, PoolSpecialization)
    {
        return (_getPoolAddress(poolId), _getPoolSpecialization(poolId));
    }

    /**
     * @dev Creates a Pool ID.
     *
     * These are deterministically created by packing the Pool's contract address and its specialization setting into
     * the ID. This saves gas by making this data easily retrievable from a Pool ID with no storage accesses.
     *
     * Since a single contract can register multiple Pools, a unique nonce must be provided to ensure Pool IDs are
     * unique.
     *
     * Pool IDs have the following layout:
     * | 20 bytes pool contract address | 2 bytes specialization setting | 10 bytes nonce |
     * MSB                                                                              LSB
     *
     * 2 bytes for the specialization setting is a bit overkill: there only three of them, which means two bits would
     * suffice. However, there's nothing else of interest to store in this extra space.
     */
    function _toPoolId(
        address pool,
        PoolSpecialization specialization,
        uint80 nonce
    ) internal pure returns (bytes32) {
        bytes32 serialized;

        serialized |= bytes32(uint256(nonce));
        serialized |= bytes32(uint256(specialization)) << (10 * 8);
        serialized |= bytes32(uint256(pool)) << (12 * 8);

        return serialized;
    }

    /**
     * @dev Returns the address of a Pool's contract.
     *
     * Due to how Pool IDs are created, this is done with no storage accesses and costs little gas.
     */
    function _getPoolAddress(bytes32 poolId) internal pure returns (address) {
        // 12 byte logical shift left to remove the nonce and specialization setting. We don't need to mask,
        // since the logical shift already sets the upper bits to zero.
        return address(uint256(poolId) >> (12 * 8));
    }

    /**
     * @dev Returns the specialization setting of a Pool.
     *
     * Due to how Pool IDs are created, this is done with no storage accesses and costs little gas.
     */
    function _getPoolSpecialization(bytes32 poolId) internal pure returns (PoolSpecialization specialization) {
        // 10 byte logical shift left to remove the nonce, followed by a 2 byte mask to remove the address.
        uint256 value = uint256(poolId >> (10 * 8)) & (2**(2 * 8) - 1);

        // Casting a value into an enum results in a runtime check that reverts unless the value is within the enum's
        // range. Passing an invalid Pool ID to this function would then result in an obscure revert with no reason
        // string: we instead perform the check ourselves to help in error diagnosis.

        // There are three Pool specialization settings: general, minimal swap info and two tokens, which correspond to
        // values 0, 1 and 2.
        _require(value < 3, Errors.INVALID_POOL_ID);

        // Because we have checked that `value` is within the enum range, we can use assembly to skip the runtime check.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            specialization := value
        }
    }
}
