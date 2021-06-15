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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";

import "./BasePool.sol";
import "./interfaces/IBasePoolRelayer.sol";

/**
 * @dev Base Pool associated with a relayer that guarantees it can only be joined/exited from the relayer itself.
 * This contract as a simple mixin for pools. Implementing pools must make sure to call the BasePool's constructor
 * properly, and validate that the given
 */
abstract contract RelayedBasePool is BasePool {
    using Address for address;

    IBasePoolRelayer public immutable relayer;

    modifier ensureRelayer(bytes32 poolId) {
        // Note that this modifier is relying on an input parameter, which is usually given by the Vault which is
        // considered a trusted party. It's up to the implementing pool whether to validate this value or not.
        _require(relayer.hasCalledPool(poolId), Errors.BASE_POOL_RELAYER_NOT_CALLED);
        _;
    }

    constructor(IBasePoolRelayer _relayer) {
        _require(address(_relayer).isContract(), Errors.RELAYER_NOT_CONTRACT);
        relayer = _relayer;
    }

    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override ensureRelayer(poolId) returns (uint256[] memory, uint256[] memory) {
        return
            super.onJoinPool(poolId, sender, recipient, balances, lastChangeBlock, protocolSwapFeePercentage, userData);
    }

    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override ensureRelayer(poolId) returns (uint256[] memory, uint256[] memory) {
        return
            super.onExitPool(poolId, sender, recipient, balances, lastChangeBlock, protocolSwapFeePercentage, userData);
    }
}
