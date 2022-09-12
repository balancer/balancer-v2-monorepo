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
    mapping(IERC20 => bytes32) private _tokenState;

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

    function getTokenStartAndEndWeights(bytes32 tokenState, uint256 denormWeightSum)
        external
        pure
        returns (uint256, uint256)
    {
        return ManagedPoolTokenLib.getTokenStartAndEndWeights(tokenState, denormWeightSum);
    }

    function getMinimumTokenEndWeight(
        IERC20[] calldata tokens,
        uint256[] calldata tokenWeights,
        uint256 denormWeightSum
    ) external returns (uint256) {
        require(_tokenState[IERC20(0)] == 0, "Mock is dirty");
        _tokenState[IERC20(0)] = bytes32("0x01");

        // We need to build the `_tokenState` mapping before we pass it to `ManagedPoolTokenLib`.
        for (uint256 i = 0; i < tokens.length; i++) {
            // We pass in a zero start weight for each token.
            // We do not want to read the start weight and this makes it obvious if this occurs.
            _tokenState[tokens[i]] = ManagedPoolTokenLib.setTokenWeight(
                bytes32(0),
                0,
                tokenWeights[i],
                denormWeightSum
            );
        }

        return ManagedPoolTokenLib.getMinimumTokenEndWeight(_tokenState, tokens, denormWeightSum);
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

    function initializeTokenState(
        IERC20 token,
        uint256 normalizedWeight,
        uint256 denormWeightSum
    ) external view returns (bytes32) {
        return ManagedPoolTokenLib.initializeTokenState(token, normalizedWeight, denormWeightSum);
    }
}
