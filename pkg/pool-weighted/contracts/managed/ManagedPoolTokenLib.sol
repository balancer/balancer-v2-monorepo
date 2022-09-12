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
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";

import "../lib/GradualValueChange.sol";
import "../lib/WeightCompression.sol";

library ManagedPoolTokenLib {
    using WordCodec for bytes32;
    using FixedPoint for uint256;
    using WeightCompression for uint256;

    // Denormalized weights are stored using the WeightCompression library as a percentage of the maximum absolute
    // denormalized weight: independent of the current _denormWeightSum, which avoids having to recompute the denorm
    // weights as the sum changes.
    uint256 private constant _MAX_DENORM_WEIGHT = 1e22; // FP 10,000

    // Store scaling factor and start/end denormalized weights for each token
    // Mapping should be more efficient than trying to compress it further
    // [ 123 bits |  5 bits  |  64 bits   |   64 bits    |
    // [ unused   | decimals | end denorm | start denorm |
    // |MSB                                           LSB|
    uint256 private constant _START_DENORM_WEIGHT_OFFSET = 0;
    uint256 private constant _END_DENORM_WEIGHT_OFFSET = 64;
    uint256 private constant _DECIMAL_DIFF_OFFSET = 128;

    uint256 private constant _DENORM_WEIGHT_WIDTH = 64;
    uint256 private constant _DECIMAL_DIFF_WIDTH = 5;

    // Getters

    /**
     * @notice Returns the token's scaling factor.
     * @param tokenState - The byte32 state of the token of interest.
     */
    function getTokenScalingFactor(bytes32 tokenState) internal pure returns (uint256) {
        uint256 decimalsDifference = tokenState.decodeUint(_DECIMAL_DIFF_OFFSET, _DECIMAL_DIFF_WIDTH);

        // This is equivalent to `10**(18+decimalsDifference)` but this form optimizes for 18 decimal tokens.
        return FixedPoint.ONE * 10**decimalsDifference;
    }

    /**
     * @notice Returns the token weight interpolated some percentage between the start and end weights.
     * @param tokenState - The byte32 state of the token of interest.
     * @param pctProgress - A 18 decimal fixed-point value corresponding to how far to interpolate between the start
     * and end weights. 0 represents the start weight and 1 represents the end weight (with values >1 being clipped).
     * @param denormWeightSum - The denormalized weight sum to be used to normalize the resulting weight.
     */
    function getTokenWeight(
        bytes32 tokenState,
        uint256 pctProgress,
        uint256 denormWeightSum
    ) internal pure returns (uint256) {
        return
            _decodeWeight(
                GradualValueChange.interpolateValue(
                    tokenState.decodeUint(_START_DENORM_WEIGHT_OFFSET, _DENORM_WEIGHT_WIDTH),
                    tokenState.decodeUint(_END_DENORM_WEIGHT_OFFSET, _DENORM_WEIGHT_WIDTH),
                    pctProgress
                ),
                denormWeightSum
            );
    }

    /**
     * @notice Returns the token's start and end weights.
     * @param tokenState - The byte32 state of the token of interest.
     * @param denormWeightSum - The denormalized weight sum to be used to normalize the resulting weights.
     */
    function getTokenStartAndEndWeights(bytes32 tokenState, uint256 denormWeightSum)
        internal
        pure
        returns (uint256, uint256)
    {
        return (
            _decodeWeight(tokenState.decodeUint(_START_DENORM_WEIGHT_OFFSET, _DENORM_WEIGHT_WIDTH), denormWeightSum),
            _decodeWeight(tokenState.decodeUint(_END_DENORM_WEIGHT_OFFSET, _DENORM_WEIGHT_WIDTH), denormWeightSum)
        );
    }

    function getMinimumTokenEndWeight(
        mapping(IERC20 => bytes32) storage tokenStates,
        IERC20[] memory tokens,
        uint256 denormWeightSum
    ) internal view returns (uint256) {
        uint256 numTokens = tokens.length;

        // We search for the minimum encoded weight as this corresponds to the minimum normalized weight.
        // This allows us to only decompress a single weight.
        uint256 minimumCompressedWeight = type(uint256).max;
        for (uint256 i = 0; i < numTokens; i++) {
            uint256 newCompressedWeight = tokenStates[tokens[i]].decodeUint(
                _END_DENORM_WEIGHT_OFFSET,
                _DENORM_WEIGHT_WIDTH
            );
            if (newCompressedWeight < minimumCompressedWeight) {
                minimumCompressedWeight = newCompressedWeight;
            }
        }

        // Finally decompress and normalize the found weight
        return _decodeWeight(minimumCompressedWeight, denormWeightSum);
    }

    // Setters

    /**
     * @notice Updates a token's start and end weights.
     * @dev To be called when initiating a gradual weight change to update the two values to interpolate between.
     * @param tokenState - The byte32 state of the token of interest.
     * @param normalizedStartWeight - The current normalized weight of the token.
     * @param normalizedEndWeight - The desired final normalized weight of the token.
     * @param denormWeightSum - The denormalized weight sum to be used to denormalize the provided weights.
     */
    function setTokenWeight(
        bytes32 tokenState,
        uint256 normalizedStartWeight,
        uint256 normalizedEndWeight,
        uint256 denormWeightSum
    ) internal pure returns (bytes32) {
        return
            tokenState
                .insertUint(
                _encodeWeight(normalizedStartWeight, denormWeightSum),
                _START_DENORM_WEIGHT_OFFSET,
                _DENORM_WEIGHT_WIDTH
            )
                .insertUint(
                _encodeWeight(normalizedEndWeight, denormWeightSum),
                _END_DENORM_WEIGHT_OFFSET,
                _DENORM_WEIGHT_WIDTH
            );
    }

    /**
     * @notice Writes the token's scaling factor into the token state.
     * @dev To save space, we store the scaling factor as the difference between 18 and the token's decimals and compute
     * the "raw" scaling factor on the fly.
     * We split this function off as we want to avoid unnecessary external calls. Token decimals do not change
     * so we can call this once when we add the token and then keep the value.
     * @param tokenState - The byte32 state of the token of interest.
     * @param token - The ERC20 token of interest.
     */
    function setTokenScalingFactor(bytes32 tokenState, IERC20 token) internal view returns (bytes32) {
        // Tokens that don't implement the `decimals` method are not supported.
        // Tokens with more than 18 decimals are not supported
        return
            tokenState.insertUint(
                uint256(18).sub(ERC20(address(token)).decimals()),
                _DECIMAL_DIFF_OFFSET,
                _DECIMAL_DIFF_WIDTH
            );
    }

    /**
     * @notice Initializes the token state for a new token.
     * @dev We disallow passing separate start and end weights as a token should not be added while a weight change
     * is ongoing.
     * @param token - The ERC20 token of interest.
     * @param normalizedWeight - The normalized weight of the token.
     * @param denormWeightSum - The denormalized weight sum to be used to denormalize the provided weights.
     */
    function initializeTokenState(
        IERC20 token,
        uint256 normalizedWeight,
        uint256 denormWeightSum
    ) internal view returns (bytes32) {
        bytes32 tokenState = bytes32(0);
        tokenState = setTokenScalingFactor(tokenState, token);
        tokenState = setTokenWeight(tokenState, normalizedWeight, normalizedWeight, denormWeightSum);
        return tokenState;
    }

    function _encodeWeight(uint256 normalizedWeight, uint256 denormWeightSum) private pure returns (uint256) {
        return normalizedWeight.mulUp(denormWeightSum).compress(_DENORM_WEIGHT_WIDTH, _MAX_DENORM_WEIGHT);
    }

    function _decodeWeight(uint256 denormalizedWeight, uint256 denormWeightSum) private pure returns (uint256) {
        return denormalizedWeight.decompress(_DENORM_WEIGHT_WIDTH, _MAX_DENORM_WEIGHT).divDown(denormWeightSum);
    }
}
