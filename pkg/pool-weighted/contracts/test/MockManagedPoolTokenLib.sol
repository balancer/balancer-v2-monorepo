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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

import "../managed/ManagedPoolTokenLib.sol";

contract MockManagedPoolTokenLib {
    // Getters

    function getTokenScalingFactor(bytes32 tokenState) external pure returns (uint256) {
        return ManagedPoolTokenLib.getTokenScalingFactor(tokenState);
    }

    function getTokenWeight(
        bytes32 tokenState,
        uint256 pctProgress,
        uint256 denormWeightSum
    ) external pure returns (uint256) {
        return ManagedPoolTokenLib.getTokenWeight(tokenState, pctProgress, denormWeightSum);
    }

    // Setters

    function setTokenWeight(
        bytes32 tokenState,
        uint256 normalizedStartWeight,
        uint256 normalizedEndWeight,
        uint256 denormWeightSum
    ) external pure returns (bytes32) {
        return
            ManagedPoolTokenLib.setTokenWeight(tokenState, normalizedStartWeight, normalizedEndWeight, denormWeightSum);
    }

    function setTokenScalingFactor(bytes32 tokenState, IERC20 token) external view returns (bytes32) {
        return ManagedPoolTokenLib.setTokenScalingFactor(tokenState, token);
    }
}
