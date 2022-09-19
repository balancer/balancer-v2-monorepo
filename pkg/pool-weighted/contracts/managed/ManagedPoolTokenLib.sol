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
import "../lib/ValueCompression.sol";

/**
 * @title Managed Pool Token Library
 * @notice Library for manipulating bitmaps used for storing token-related state in ManagedPool.
 * @dev
 *
 * This library stores all token weights in a denormalized format. This allows us to add and remove tokens without
 * having to adjust the weights of all other tokens. These denormalized weights can be converted to and from the
 * normalized weight format expected by the Pool by dividing/multiplying by a normalization factor (commonly referred
 * to as the `denormWeightSum`).
 *
 * This `denormWeightSum` is stored at the Pool level, and so must be passed into this library on each call that impacts
 * token weights. Specifically, for getters that take this sum as a parameter (e.g., `getTokenWeight`), pass in the
 * value of `denormWeightSum` used on the most recent call to `setTokenWeight` or `initializeTokenState`.
 */
library ManagedPoolTokenLib {
    using WordCodec for bytes32;
    using FixedPoint for uint256;
    using ValueCompression for uint256;

    // Store token-based values:
    // Each token's scaling factor (encoded as the scaling factor's exponent / token decimals).
    // Each token's starting and ending denormalized weights.
    // [ 123 bits |  5 bits  |       64 bits     |       64 bits       |
    // [  unused  | decimals | end denorm weight | start denorm weight |
    // |MSB                                                         LSB|
    uint256 private constant _START_DENORM_WEIGHT_OFFSET = 0;
    uint256 private constant _END_DENORM_WEIGHT_OFFSET = _START_DENORM_WEIGHT_OFFSET + _DENORM_WEIGHT_WIDTH;
    uint256 private constant _DECIMAL_DIFF_OFFSET = _END_DENORM_WEIGHT_OFFSET + _DENORM_WEIGHT_WIDTH;

    uint256 private constant _DENORM_WEIGHT_WIDTH = 64;
    uint256 private constant _DECIMAL_DIFF_WIDTH = 5;

    // Denormalized weights are stored using the ValueCompression library as a percentage of the maximum absolute
    // denormalized weight.
    // We store the weights as values in the range [0, 2**_DENORM_WEIGHT_WIDTH) and then map these to the (larger)
    // range [0, _MAX_DENORM_WEIGHT], trading some resolution for being able to express a wider range of weight ratios.
    uint256 private constant _MAX_DENORM_WEIGHT = 1e22; // FP 10,000;

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
     * @notice Returns the token weight, interpolated between the starting and ending weights.
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
     * @notice Returns the token's starting and ending weights.
     * @param tokenState - The byte32 state of the token of interest.
     * @param denormWeightSum - The denormalized weight sum to be used to normalize the resulting weights.
     * @return normalizedStartWeight - The starting normalized weight of the token.
     * @return normalizedEndWeight - The ending normalized weight of the token.
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

    /**
     * @notice Returns the token's starting and ending weights.
     * @param tokenStates - A mapping from ERC20 token addresses to their token states.
     * @param tokens - An array of ERC20 token addresses.
     * @param denormWeightSum - The denormalized weight sum to be used to normalize the returned weight.
     * @return minimumNormalizedEndWeight - The smallest normalized end weight in `tokenStates`.
     */
    function getMinimumTokenEndWeight(
        mapping(IERC20 => bytes32) storage tokenStates,
        IERC20[] memory tokens,
        uint256 denormWeightSum
    ) internal view returns (uint256) {
        uint256 numTokens = tokens.length;

        // We search for the minimum encoded weight, as this corresponds to the minimum normalized weight.
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

        // Finally, decompress and normalize the minimum weight found in the previous step.
        return _decodeWeight(minimumCompressedWeight, denormWeightSum);
    }

    // Setters

    /**
     * @notice Updates a token's starting and ending weights.
     * @dev Initiate a gradual weight change between the given starting and ending values.
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
     * @dev To save space, we store the scaling factor as the difference between 18 and the token's decimals,
     * and compute the "raw" scaling factor on the fly.
     * We segregated this function to avoid unnecessary external calls. Token decimals do not change, so we
     * only need to call this once per token: either from the constructor, for the initial set of tokens, or
     * when adding a new token.
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
     * @dev Since weights must be fixed during add/remove operations, we only need to supply a single normalized weight.
     * @param token - The ERC20 token of interest.
     * @param normalizedWeight - The normalized weight of the token.
     * @param denormWeightSum - The denormalized weight sum to be used to denormalize the given weight.
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

    // Private functions

    function _encodeWeight(uint256 normalizedWeight, uint256 denormWeightSum) private pure returns (uint256) {
        return normalizedWeight.mulUp(denormWeightSum).compress(_DENORM_WEIGHT_WIDTH, _MAX_DENORM_WEIGHT);
    }

    function _decodeWeight(uint256 denormalizedWeight, uint256 denormWeightSum) private pure returns (uint256) {
        return denormalizedWeight.decompress(_DENORM_WEIGHT_WIDTH, _MAX_DENORM_WEIGHT).divDown(denormWeightSum);
    }
}
