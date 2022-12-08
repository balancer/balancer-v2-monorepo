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

import "../managed/ManagedPoolTokenStorageLib.sol";

contract MockManagedPoolTokenStorageLib {
    mapping(IERC20 => bytes32) private _tokenState;

    // Getters

    function getTokenScalingFactor(bytes32 tokenState) external pure returns (uint256) {
        return ManagedPoolTokenStorageLib.getTokenScalingFactor(tokenState);
    }

    function getTokenWeight(bytes32 tokenState, uint256 pctProgress) external pure returns (uint256) {
        return ManagedPoolTokenStorageLib.getTokenWeight(tokenState, pctProgress);
    }

    function getTokenStartAndEndWeights(bytes32 tokenState) external pure returns (uint256, uint256) {
        return ManagedPoolTokenStorageLib.getTokenStartAndEndWeights(tokenState);
    }

    // Setters

    function setTokenWeight(
        bytes32 tokenState,
        uint256 normalizedStartWeight,
        uint256 normalizedEndWeight
    ) external pure returns (bytes32) {
        return ManagedPoolTokenStorageLib.setTokenWeight(tokenState, normalizedStartWeight, normalizedEndWeight);
    }

    function setTokenScalingFactor(bytes32 tokenState, IERC20 token) external view returns (bytes32) {
        return ManagedPoolTokenStorageLib.setTokenScalingFactor(tokenState, token);
    }

    function initializeTokenState(IERC20 token, uint256 normalizedWeight) external view returns (bytes32) {
        return ManagedPoolTokenStorageLib.initializeTokenState(token, normalizedWeight);
    }
}
