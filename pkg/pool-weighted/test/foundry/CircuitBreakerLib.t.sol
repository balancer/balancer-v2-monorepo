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

import { Test } from "forge-std/Test.sol";

import "../../contracts/managed/CircuitBreakerStorageLib.sol";

contract CircuitBreakerLibTest is Test {
    using FixedPoint for uint256;

    uint256 private constant _MINIMUM_BOUND_PERCENTAGE = 1e17; // 0.1
    uint256 private constant _MINIMUM_TOKEN_WEIGHT = 1e16; // 0.01 (1%)
    uint256 private constant _MAXIMUM_TOKEN_WEIGHT = 99e16; // 0.99 (99%)
    uint256 private constant _MAX_BOUND_PERCENTAGE = 10e18; // 10.0
    uint256 private constant _MIN_BPT_PRICE = 1e6;

    uint256 private constant _MAX_RELATIVE_ERROR = 1e16;
    uint256 private constant _MAX_BPT_PRICE = type(uint96).max;

    function testReferenceParams(
        uint256 bptPrice,
        uint256 referenceWeight,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        bptPrice = bound(bptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        referenceWeight = bound(referenceWeight, _MINIMUM_TOKEN_WEIGHT, _MAXIMUM_TOKEN_WEIGHT);
        lowerBound = bound(lowerBound, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);
        upperBound = bound(upperBound, lowerBound, _MAX_BOUND_PERCENTAGE);

        bytes32 poolState = CircuitBreakerStorageLib.setCircuitBreaker(bptPrice, referenceWeight, lowerBound, upperBound);
        (
            uint256 actualBptPrice,
            uint256 actualReferenceWeight,
            uint256 actualLowerBound,
            uint256 actualUpperBound
        ) = CircuitBreakerStorageLib.getCircuitBreakerFields(poolState);

        assertEq(actualBptPrice, bptPrice);
        assertEq(actualReferenceWeight, referenceWeight);
        assertApproxEqRel(actualLowerBound, lowerBound, _MAX_RELATIVE_ERROR);
        assertApproxEqRel(actualUpperBound, upperBound, _MAX_RELATIVE_ERROR);
    }

    function testReferenceBoundRatios(
        uint256 bptPrice,
        uint256 referenceWeight,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        bptPrice = bound(bptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        referenceWeight = bound(referenceWeight, _MINIMUM_TOKEN_WEIGHT, _MAXIMUM_TOKEN_WEIGHT);
        lowerBound = bound(lowerBound, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);
        upperBound = bound(upperBound, lowerBound, _MAX_BOUND_PERCENTAGE);

        uint256 expectedLowerBoundBptPrice = uint256(bptPrice).mulDown(lowerBound.powUp(FixedPoint.ONE - referenceWeight));
        uint256 expectedUpperBoundBptPrice = uint256(bptPrice).mulDown(upperBound.powDown(FixedPoint.ONE - referenceWeight));

        bytes32 poolState = CircuitBreakerStorageLib.setCircuitBreaker(bptPrice, referenceWeight, lowerBound, upperBound);

        // Test that calling it with the reference weight retrieves exact values from the ratio cache
        (uint256 actualLowerBoundBptPrice, uint256 actualUpperBoundBptPrice) = CircuitBreakerStorageLib
            .getBptPriceBounds(poolState, referenceWeight);

        assertApproxEqRel(actualLowerBoundBptPrice, expectedLowerBoundBptPrice, _MAX_RELATIVE_ERROR);
        assertApproxEqRel(actualUpperBoundBptPrice, expectedUpperBoundBptPrice, _MAX_RELATIVE_ERROR);

        // Single sided
        uint256 singleSidedLowerBoundBptPrice = CircuitBreakerStorageLib.getCurrentCircuitBreakerBound(poolState, referenceWeight, true);
        uint256 singleUpperBoundBptPrice = CircuitBreakerStorageLib.getCurrentCircuitBreakerBound(poolState, referenceWeight, false);

        assertEq(singleSidedLowerBoundBptPrice, actualLowerBoundBptPrice);
        assertEq(singleUpperBoundBptPrice, actualUpperBoundBptPrice);
    }

    function testDynamicBoundRatios(
        uint256 bptPrice,
        uint256 referenceWeight,
        uint256 newWeight,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        bptPrice = bound(bptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        lowerBound = bound(lowerBound, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);
        upperBound = bound(upperBound, lowerBound, _MAX_BOUND_PERCENTAGE);
        referenceWeight = bound(referenceWeight, _MINIMUM_TOKEN_WEIGHT, _MAXIMUM_TOKEN_WEIGHT);
        newWeight = bound(newWeight, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);

        // Set the initial state of the breaker
        bytes32 referencePoolState = CircuitBreakerStorageLib.setCircuitBreaker(
            bptPrice,
            referenceWeight,
            lowerBound,
            upperBound
        );
        (uint256 lowerBptPriceBoundary, uint256 upperBptPriceBoundary) = CircuitBreakerStorageLib
            .getBptPriceBounds(referencePoolState, newWeight);

        (uint256 expectedLowerBptPrice, uint256 expectedUpperBptPrice) = CircuitBreakerLib.calcAdjustedBounds(
            lowerBound,
            upperBound,
            newWeight
        );
        assertApproxEqRel(
            lowerBptPriceBoundary,
            uint256(bptPrice).mulDown(expectedLowerBptPrice),
            _MAX_RELATIVE_ERROR
        );
        assertApproxEqRel(
            upperBptPriceBoundary,
            uint256(bptPrice).mulUp(expectedUpperBptPrice),
            _MAX_RELATIVE_ERROR
        );

        // Single-sided

        uint256 singleSidedLowerBptPrice = CircuitBreakerLib.calcBoundaryConversionRatio(lowerBound, newWeight, true);
        uint256 singleSidedUpperBptPrice = CircuitBreakerLib.calcBoundaryConversionRatio(upperBound, newWeight, false);

        assertEq(singleSidedLowerBptPrice, expectedLowerBptPrice);
        assertEq(singleSidedUpperBptPrice, expectedUpperBptPrice);
    }

    function testUpdateCachedRatios(
        uint256 bptPrice,
        uint256 referenceWeight,
        uint256 newWeight,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        bptPrice = bound(bptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        lowerBound = bound(lowerBound, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);
        upperBound = bound(upperBound, lowerBound, _MAX_BOUND_PERCENTAGE);
        referenceWeight = bound(referenceWeight, _MINIMUM_TOKEN_WEIGHT, _MAXIMUM_TOKEN_WEIGHT);
        newWeight = bound(newWeight, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);

        // Set the initial state of the breaker
        bytes32 referencePoolState = CircuitBreakerStorageLib.setCircuitBreaker(
            bptPrice,
            referenceWeight,
            lowerBound,
            upperBound
        );

        // We now model the weight of the the token changing so `referenceWeight` becomes `newWeight`.
        // As a result we can't use the cached bound ratios and have to recalculate them on the fly.
        uint256 dynamicCost = gasleft();
        (uint256 lowerBptPriceBoundary, uint256 upperBptPriceBoundary) = CircuitBreakerStorageLib.getBptPriceBounds(
            referencePoolState,
            newWeight
        );
        dynamicCost -= gasleft();

        // This is expensive so we refresh the cached bound ratios using the new weight.
        bytes32 updatedPoolState = CircuitBreakerStorageLib.updateAdjustedBounds(referencePoolState, newWeight);

        uint256 cachedCost = gasleft();
        (uint256 newCachedLowerBptPriceBoundary, uint256 newCachedUpperBptPriceBoundary) = CircuitBreakerStorageLib
            .getBptPriceBounds(updatedPoolState, newWeight);
        cachedCost -= gasleft();

        // The new cached values should match what was previously calculated dynamically.
        uint256 MAX_ERROR = 1e11;
        assertApproxEqRel(newCachedLowerBptPriceBoundary, lowerBptPriceBoundary, MAX_ERROR);
        assertApproxEqRel(newCachedUpperBptPriceBoundary, upperBptPriceBoundary, MAX_ERROR);

        // Using the new cached values should reduce costs by over 2/3rds
        assertLe(cachedCost, dynamicCost / 3);
    }

    function assertApproxEqRel(
        uint256 a,
        uint256 b,
        uint256 maxPercentDelta
    ) internal override {
        if ((b * maxPercentDelta) / 1e18 == 0) {
            assertApproxEqAbs(a, b, 1);
        } else {
            super.assertApproxEqRel(a, b, maxPercentDelta);
        }
    }
}
