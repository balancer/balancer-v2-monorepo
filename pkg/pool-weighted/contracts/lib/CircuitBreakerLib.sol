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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "../lib/ValueCompression.sol";

/**
 * @title Circuit Breaker Library
 * @notice Library for logic and functions related to circuit breakers.
 */
library CircuitBreakerLib {
    using FixedPoint for uint256;

    /**
     * @notice Checks whether either the lower or upper circuit breakers would trip in the given pool state.
     * @dev Compute the current BPT price from the input parameters, and compare it to the bounds to determine whether
     * the given post-operation pool state is within the circuit breaker bounds.
     * @param virtualSupply - the post-operation totalSupply (including protocol fees, etc.)
     * @param normalizedWeight - the normalized weight of the token we are checking.
     * @param upscaledBalance - the post-operation token balance (including swap fees, etc.). It must be an 18-decimal
     * @param lowerBoundBptPrice - the lowest BPT price in the allowed trading range.
     * @param upperBoundBptPrice - the highest BPT price in the allowed trading range.
     * floating point number, adjusted by the scaling factor of the token.
     * @return - boolean flags set to true if the breaker should be tripped: (lowerBoundTripped, upperBoundTripped)
     */
    function hasCircuitBreakerTripped(
        uint256 virtualSupply,
        uint256 normalizedWeight,
        uint256 upscaledBalance,
        uint256 lowerBoundBptPrice,
        uint256 upperBoundBptPrice
    ) internal pure returns (bool, bool) {
        uint256 currentBptPrice = virtualSupply.mulUp(normalizedWeight).divDown(upscaledBalance);

        return (
            lowerBoundBptPrice != 0 && currentBptPrice < lowerBoundBptPrice,
            upperBoundBptPrice != 0 && currentBptPrice > upperBoundBptPrice
        );
    }

    /**
     * @notice Convert bounds to BPT prices
     * @param lowerBound - the lower bound percentage; 0.8 means tolerate a 20% relative drop.
     * @param upperBound - the upper bound percentage; 5.0 means tolerate a 5x increase.
     * @param weightComplement - the complement of the normalized token weight: 1 - weight.
     */
    function calcBoundaryConversionRatios(
        uint256 lowerBound,
        uint256 upperBound,
        uint256 weightComplement
    ) internal pure returns (uint256 lowerBoundRatio, uint256 upperBoundRatio) {
        // To be conservative and protect LPs, round up for the lower bound, and down for the upper bound.
        lowerBoundRatio = lowerBound.powUp(weightComplement);
        upperBoundRatio = upperBound.powDown(weightComplement);
    }
}
