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

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

/**
 * @title Circuit Breaker Library
 * @notice Library for logic and functions related to circuit breakers.
 */
library CircuitBreakerLib {
    using FixedPoint for uint256;

    /**
     * @notice Single-sided check for whether a lower or upper circuit breaker would trip in the given pool state.
     * @dev Compute the current BPT price from the input parameters, and compare it to the given bound to determine
     * whether the given post-operation pool state is within the circuit breaker bounds.
     * @param virtualSupply - the post-operation totalSupply (including protocol fees, etc.)
     * @param weight - the normalized weight of the token we are checking.
     * @param balance - the post-operation token balance (including swap fees, etc.). It must be an 18-decimal
     * floating point number, adjusted by the scaling factor of the token.
     * @param boundBptPrice - the BPT price at the limit (lower or upper) of the allowed trading range.
     * @param isLowerBound - true if the boundBptPrice represents the lower bound.
     * @return - boolean flag set to true if the breaker should be tripped
     */
    function hasCircuitBreakerTripped(
        uint256 virtualSupply,
        uint256 weight,
        uint256 balance,
        uint256 boundBptPrice,
        bool isLowerBound
    ) internal pure returns (bool) {
        if (boundBptPrice == 0) {
            return false;
        }

        uint256 currentBptPrice = virtualSupply.mulUp(weight).divDown(balance);

        return isLowerBound ? currentBptPrice < boundBptPrice : currentBptPrice > boundBptPrice;
    }

    /**
     * @notice Checks whether either the lower or upper circuit breakers would trip in the given pool state.
     * @dev Compute the current BPT price from the input parameters, and compare it to the bounds to determine whether
     * the given post-operation pool state is within the circuit breaker bounds.
     * @param virtualSupply - the post-operation totalSupply (including protocol fees, etc.)
     * @param weight - the normalized weight of the token we are checking.
     * @param balance - the post-operation token balance (including swap fees, etc.). It must be an 18-decimal
     * floating point number, adjusted by the scaling factor of the token.
     * @param lowerBoundBptPrice - the lowest BPT price in the allowed trading range.
     * @param upperBoundBptPrice - the highest BPT price in the allowed trading range.
     * @return - boolean flags set to true if the breaker should be tripped: (lowerBoundTripped, upperBoundTripped)
     */
    function hasCircuitBreakerTripped(
        uint256 virtualSupply,
        uint256 weight,
        uint256 balance,
        uint256 lowerBoundBptPrice,
        uint256 upperBoundBptPrice
    ) internal pure returns (bool, bool) {
        uint256 currentBptPrice = virtualSupply.mulUp(weight).divDown(balance);

        return (
            lowerBoundBptPrice != 0 && currentBptPrice < lowerBoundBptPrice,
            upperBoundBptPrice != 0 && currentBptPrice > upperBoundBptPrice
        );
    }

    /**
     * @notice Convert bounds to adjusted bounds (apply non-linear adjustment for weights)
     * @param lowerBound - the lower bound percentage; 0.8 means tolerate a 20% relative drop.
     * @param upperBound - the upper bound percentage; 5.0 means tolerate a 5x increase.
     * @param weight - the current normalized token weight.
     * @return adjustedLowerBound - the final lower bound, adjusted for any weight changes.
     * @return adjustedUpperBound - the final upper bound, adjusted for any weight changes.
     * At any given time, the BPT price trading range is defined by the BPT price at the time
     * the circuit breaker was set, multiplied by the weight-adjusted bounds.
     */
    function calcAdjustedBounds(
        uint256 lowerBound,
        uint256 upperBound,
        uint256 weight
    ) internal pure returns (uint256 adjustedLowerBound, uint256 adjustedUpperBound) {
        uint256 weightComplement = weight.complement();

        // To be conservative and protect LPs, round up for the lower bound, and down for the upper bound.
        adjustedLowerBound = lowerBound.powUp(weightComplement);
        adjustedUpperBound = upperBound.powDown(weightComplement);
    }

    /**
     * @notice Convert adjusted bounds to BPT prices
     * @param adjustedLowerBound - the lower bound after applying the weight adjustment
     * @param adjustedUpperBound - the upper bound after applying the weight adjustment
     * @param bptPrice - The BPT price stored at the time the breaker was set.
     */
    function calcBptPriceBoundaries(
        uint256 adjustedLowerBound,
        uint256 adjustedUpperBound,
        uint256 bptPrice
    ) internal pure returns (uint256 lowerBoundBptPrice, uint256 upperBoundBptPrice) {
        // To be conservative and protect LPs, round up for the lower bound, and down for the upper bound.
        lowerBoundBptPrice = bptPrice.mulUp(adjustedLowerBound);
        upperBoundBptPrice = bptPrice.mulDown(adjustedUpperBound);
    }

    /**
     * @notice Convert a bound to a BPT price ratio
     * @param bound - The bound percentage.
     * @param weight - The current normalized token weight.
     * @param isLowerBound - A flag indicating whether this is for a lower bound.
     */
    function calcBoundaryConversionRatio(
        uint256 bound,
        uint256 weight,
        bool isLowerBound
    ) internal pure returns (uint256 boundRatio) {
        uint256 weightComplement = weight.complement();

        // To be conservative and protect LPs, round up for the lower bound, and down for the upper bound.
        boundRatio = (isLowerBound ? FixedPoint.powUp : FixedPoint.powDown)(bound, weightComplement);
    }

    /**
     * @notice Convert a BPT price ratio to a BPT price bound
     * @param boundRatio - The cached bound ratio
     * @param bptPrice - The BPT price stored at the time the breaker was set.
     * @param isLowerBound - A flag indicating whether this is for a lower bound.
     */
    function calcBptPriceBoundary(
        uint256 boundRatio,
        uint256 bptPrice,
        bool isLowerBound
    ) internal pure returns (uint256 boundBptPrice) {
        // To be conservative and protect LPs, round up for the lower bound, and down for the upper bound.
        boundBptPrice = (isLowerBound ? FixedPoint.mulUp : FixedPoint.mulDown)(bptPrice, boundRatio);
    }
}
