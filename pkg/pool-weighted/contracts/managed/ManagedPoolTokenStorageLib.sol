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

/**
 * @title Managed Pool Token Library
 * @notice Library for manipulating bitmaps used for storing token-related state in ManagedPool.
 * @dev
 *
 * This library stores all token weights in a normalized format, meaning they add up to 100% (1.0 in 18 decimal fixed
 * point format).
 */
library ManagedPoolTokenStorageLib {
    using WordCodec for bytes32;
    using FixedPoint for uint256;

    // Store token-based values:
    // Each token's scaling factor (encoded as the scaling factor's exponent / token decimals).
    // Each token's starting and ending normalized weights.
    // [ 123 bits |  5 bits  |     64 bits     |     64 bits       |
    // [  unused  | decimals | end norm weight | start norm weight |
    // |MSB                                                     LSB|
    uint256 private constant _START_NORM_WEIGHT_OFFSET = 0;
    uint256 private constant _END_NORM_WEIGHT_OFFSET = _START_NORM_WEIGHT_OFFSET + _NORM_WEIGHT_WIDTH;
    uint256 private constant _DECIMAL_DIFF_OFFSET = _END_NORM_WEIGHT_OFFSET + _NORM_WEIGHT_WIDTH;

    uint256 private constant _NORM_WEIGHT_WIDTH = 64;
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
     * @notice Returns the token weight, interpolated between the starting and ending weights.
     * @param tokenState - The byte32 state of the token of interest.
     * @param pctProgress - A 18 decimal fixed-point value corresponding to how far to interpolate between the start
     * and end weights. 0 represents the start weight and 1 represents the end weight (with values >1 being clipped).
     */
    function getTokenWeight(bytes32 tokenState, uint256 pctProgress) internal pure returns (uint256) {
        return
            GradualValueChange.interpolateValue(
                tokenState.decodeUint(_START_NORM_WEIGHT_OFFSET, _NORM_WEIGHT_WIDTH),
                tokenState.decodeUint(_END_NORM_WEIGHT_OFFSET, _NORM_WEIGHT_WIDTH),
                pctProgress
            );
    }

    /**
     * @notice Returns the token's starting and ending weights.
     * @param tokenState - The byte32 state of the token of interest.
     * @return normalizedStartWeight - The starting normalized weight of the token.
     * @return normalizedEndWeight - The ending normalized weight of the token.
     */
    function getTokenStartAndEndWeights(bytes32 tokenState)
        internal
        pure
        returns (uint256 normalizedStartWeight, uint256 normalizedEndWeight)
    {
        normalizedStartWeight = tokenState.decodeUint(_START_NORM_WEIGHT_OFFSET, _NORM_WEIGHT_WIDTH);
        normalizedEndWeight = tokenState.decodeUint(_END_NORM_WEIGHT_OFFSET, _NORM_WEIGHT_WIDTH);
    }

    // Setters

    /**
     * @notice Updates a token's starting and ending weights.
     * @dev Initiate a gradual weight change between the given starting and ending values.
     * @param tokenState - The byte32 state of the token of interest.
     * @param normalizedStartWeight - The current normalized weight of the token.
     * @param normalizedEndWeight - The desired final normalized weight of the token.
     */
    function setTokenWeight(
        bytes32 tokenState,
        uint256 normalizedStartWeight,
        uint256 normalizedEndWeight
    ) internal pure returns (bytes32) {
        return
            tokenState.insertUint(normalizedStartWeight, _START_NORM_WEIGHT_OFFSET, _NORM_WEIGHT_WIDTH).insertUint(
                normalizedEndWeight,
                _END_NORM_WEIGHT_OFFSET,
                _NORM_WEIGHT_WIDTH
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
     */
    function initializeTokenState(IERC20 token, uint256 normalizedWeight) internal view returns (bytes32 tokenState) {
        tokenState = setTokenScalingFactor(bytes32(0), token);
        tokenState = setTokenWeight(tokenState, normalizedWeight, normalizedWeight);
    }
}
