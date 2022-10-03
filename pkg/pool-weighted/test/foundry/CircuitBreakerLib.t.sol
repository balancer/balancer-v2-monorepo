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

import "../../contracts/lib/CircuitBreakerLib.sol";

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
        uint256 normalizedWeight,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        bptPrice = bound(bptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        normalizedWeight = bound(normalizedWeight, _MINIMUM_TOKEN_WEIGHT, _MAXIMUM_TOKEN_WEIGHT);
        lowerBound = bound(lowerBound, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);
        upperBound = bound(upperBound, lowerBound, _MAX_BOUND_PERCENTAGE);

        bytes32 poolState = CircuitBreakerLib.setCircuitBreaker(
            bptPrice,
            normalizedWeight,
            lowerBound,
            upperBound
        );
        (
            uint256 actualBptPrice,
            uint256 actualNormalizedWeight,
            uint256 actualLowerBound,
            uint256 actualUpperBound
        ) = CircuitBreakerLib.getCircuitBreakerFields(poolState);

        assertEq(actualBptPrice, bptPrice);
        assertEq(actualNormalizedWeight, normalizedWeight);
        assertApproxEqRel(actualLowerBound, lowerBound, _MAX_RELATIVE_ERROR);
        assertApproxEqRel(actualUpperBound, upperBound, _MAX_RELATIVE_ERROR);
    }

    function testReferenceBoundRatios(
        uint256 bptPrice,
        uint256 normalizedWeight,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        bptPrice = bound(bptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        normalizedWeight = bound(normalizedWeight, _MINIMUM_TOKEN_WEIGHT, _MAXIMUM_TOKEN_WEIGHT);
        lowerBound = bound(lowerBound, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);
        upperBound = bound(upperBound, lowerBound, _MAX_BOUND_PERCENTAGE);

        uint256 weightComplement = normalizedWeight.complement();

        uint256 expectedLowerBoundBptPrice = uint256(bptPrice).mulDown(lowerBound.powUp(weightComplement));
        uint256 expectedUpperBoundBptPrice = uint256(bptPrice).mulDown(upperBound.powDown(weightComplement));

        bytes32 poolState = CircuitBreakerLib.setCircuitBreaker(
            bptPrice,
            normalizedWeight,
            lowerBound,
            upperBound
        );

        // Test that calling it with the original normalizedWeight retrieves exact values from the ratio cache
        uint256 actualLowerBoundBptPrice  = CircuitBreakerLib.getCurrentCircuitBreakerBound(poolState, normalizedWeight, true);
        uint256 actualUpperBoundBptPrice  = CircuitBreakerLib.getCurrentCircuitBreakerBound(poolState, normalizedWeight, false);

        assertApproxEqRel(actualLowerBoundBptPrice, expectedLowerBoundBptPrice, _MAX_RELATIVE_ERROR);
        assertApproxEqRel(actualUpperBoundBptPrice, expectedUpperBoundBptPrice, _MAX_RELATIVE_ERROR);
    }

    function testDynamicBoundRatios(
        uint256 referenceBptPrice,
        uint256 referenceNormalizedWeight,
        uint256 newNormalizedWeight,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        referenceBptPrice = bound(referenceBptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        lowerBound = bound(lowerBound, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);
        upperBound = bound(upperBound, lowerBound, _MAX_BOUND_PERCENTAGE);
        referenceNormalizedWeight = bound(referenceNormalizedWeight, _MINIMUM_TOKEN_WEIGHT, _MAXIMUM_TOKEN_WEIGHT);
        newNormalizedWeight = bound(newNormalizedWeight, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);

        // Set the reference state of the breaker
        bytes32 referencePoolState = CircuitBreakerLib.setCircuitBreaker(
            referenceBptPrice,
            referenceNormalizedWeight,
            lowerBound,
            upperBound
        );

        uint256 lowerBptPriceBoundary = CircuitBreakerLib.getCurrentCircuitBreakerBound(referencePoolState, newNormalizedWeight, true);
        uint256 upperBptPriceBoundary = CircuitBreakerLib.getCurrentCircuitBreakerBound(referencePoolState, newNormalizedWeight, false);

        (uint256 expectedLowerBptPrice, uint256 expectedUpperBptPrice) = CircuitBreakerLib.getBoundaryConversionRatios(
            lowerBound,
            upperBound,
            newNormalizedWeight
        );
        assertApproxEqRel(
            lowerBptPriceBoundary,
            uint256(referenceBptPrice).mulDown(expectedLowerBptPrice),
            _MAX_RELATIVE_ERROR
        );
        assertApproxEqRel(
            upperBptPriceBoundary,
            uint256(referenceBptPrice).mulUp(expectedUpperBptPrice),
            _MAX_RELATIVE_ERROR
        );
    }

    function testUpdateCachedRatios(
        uint256 referenceBptPrice,
        uint256 referenceNormalizedWeight,
        uint256 newNormalizedWeight,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        referenceBptPrice = bound(referenceBptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        lowerBound = bound(lowerBound, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);
        upperBound = bound(upperBound, lowerBound, _MAX_BOUND_PERCENTAGE);
        referenceNormalizedWeight = bound(referenceNormalizedWeight, _MINIMUM_TOKEN_WEIGHT, _MAXIMUM_TOKEN_WEIGHT);
        newNormalizedWeight = bound(newNormalizedWeight, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);

        // Set the reference state of the breaker
        bytes32 referencePoolState = CircuitBreakerLib.setCircuitBreaker(
            referenceBptPrice,
            referenceNormalizedWeight,
            lowerBound,
            upperBound
        );

        // We now model the weight of the the token changing so `referenceNormalizedWeight` becomes `newNormalizedWeight`.
        // As a result we can't use the cached bound ratios and have to recalculate them on the fly.
        uint256 dynamicCost = gasleft();
        uint256 lowerBptPriceBoundary = CircuitBreakerLib.getCurrentCircuitBreakerBound(referencePoolState, newNormalizedWeight, true);
        uint256 upperBptPriceBoundary = CircuitBreakerLib.getCurrentCircuitBreakerBound(referencePoolState, newNormalizedWeight, false);

        dynamicCost -= gasleft();

        // This is expensive so we refresh the cached bound ratios using the new weight.
        bytes32 updatedPoolState = CircuitBreakerLib.updateBoundRatios(referencePoolState, newNormalizedWeight);

        uint256 cachedCost = gasleft();
        uint256 newCachedLowerBptPriceBoundary = CircuitBreakerLib.getCurrentCircuitBreakerBound(updatedPoolState, newNormalizedWeight, true);
        uint256 newCachedUpperBptPriceBoundary = CircuitBreakerLib.getCurrentCircuitBreakerBound(updatedPoolState, newNormalizedWeight, false);

        cachedCost -= gasleft();

        // The new cached values should match what was previously calculated dynamically.
        uint256 MAX_ERROR = 1e11;
        assertApproxEqRel(newCachedLowerBptPriceBoundary, lowerBptPriceBoundary, MAX_ERROR);
        assertApproxEqRel(newCachedUpperBptPriceBoundary, upperBptPriceBoundary, MAX_ERROR);

        // Using the new cached values should reduce costs by over 1/3rd
        assertLe(cachedCost, dynamicCost * 2 / 3);
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
