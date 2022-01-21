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

import "./LegacyBasePool.sol";
import "./interfaces/IBasePoolRelayer.sol";
import "./interfaces/IRelayedBasePool.sol";

/**
 * @dev Base Pool associated with a relayer that guarantees it can only be joined/exited from the relayer itself.
 * This contract is a simple mixin for pools. Implementing pools must make sure to call the BasePool's constructor
 * properly.
 */
abstract contract RelayedBasePool is LegacyBasePool, IRelayedBasePool {
    using Address for address;

    IBasePoolRelayer internal immutable _relayer;

    modifier ensureRelayerCall(bytes32 poolId) {
        _require(_relayer.hasCalledPool(poolId), Errors.BASE_POOL_RELAYER_NOT_CALLED);
        _;
    }

    constructor(IBasePoolRelayer relayer) {
        _require(address(relayer).isContract(), Errors.RELAYER_NOT_CONTRACT);
        _relayer = relayer;
    }

    function getRelayer() public view override returns (IBasePoolRelayer) {
        return _relayer;
    }

    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override ensureRelayerCall(poolId) returns (uint256[] memory, uint256[] memory) {
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
    ) public virtual override ensureRelayerCall(poolId) returns (uint256[] memory, uint256[] memory) {
        return
            super.onExitPool(poolId, sender, recipient, balances, lastChangeBlock, protocolSwapFeePercentage, userData);
    }
}
