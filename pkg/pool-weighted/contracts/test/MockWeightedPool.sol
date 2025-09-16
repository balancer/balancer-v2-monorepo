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

import "../WeightedPool.sol";

contract MockWeightedPool is WeightedPool {
    constructor(
        NewPoolParams memory params,
        IVault vault,
        IProtocolFeePercentagesProvider protocolFeeProvider,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    ) WeightedPool(params, vault, protocolFeeProvider, pauseWindowDuration, bufferPeriodDuration, owner) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function isOwnerOnlyAction(bytes32 actionId) external view returns (bool) {
        return _isOwnerOnlyAction(actionId);
    }
}