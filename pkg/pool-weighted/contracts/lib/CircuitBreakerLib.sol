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
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

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
     * @return - boolean flag for whether the breaker has been tripped.
     */
    function hasCircuitBreakerTripped(
        uint256 virtualSupply,
        uint256 weight,
        uint256 balance,
        uint256 boundBptPrice,
        bool isLowerBound
    ) internal pure returns (bool) {
        // A bound price of 0 means that no breaker is set.
        if (boundBptPrice == 0) {
            return false;
        }

        // Round down for lower bound checks, up for upper bound checks
        uint256 currentBptPrice = Math.div(Math.mul(virtualSupply, weight), balance, !isLowerBound);

        return isLowerBound ? currentBptPrice < boundBptPrice : currentBptPrice > boundBptPrice;
    }

    /**
     * @notice Convert a bound to a BPT price ratio
     * @param bound - The bound percentage.
     * @param weight - The current normalized token weight.
     * @param isLowerBound - A flag indicating whether this is for a lower bound.
     */
    function calcAdjustedBound(
        uint256 bound,
        uint256 weight,
        bool isLowerBound
    ) external pure returns (uint256 boundRatio) {
        // To be conservative and protect LPs, round up for the lower bound, and down for the upper bound.
        boundRatio = (isLowerBound ? FixedPoint.powUp : FixedPoint.powDown)(bound, weight.complement());
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
