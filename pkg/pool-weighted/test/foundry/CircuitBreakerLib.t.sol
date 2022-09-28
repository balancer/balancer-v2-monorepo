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

    uint256 private constant _MINIMUM_BOUND_PERCENTAGE = 1e17;  // 0.1
    // The weight complement (1 - w) is bounded by the min/max token weights
    uint256 private constant _MINIMUM_TOKEN_WEIGHT = 1e16; // 0.01 (1%)
    uint256 private constant _MAXIMUM_TOKEN_WEIGHT = 99e16; // 0.99 (99%)
    uint256 private constant _MAX_BOUND_PERCENTAGE = 10e18; // 10.0
    uint256 private constant _MIN_BPT_PRICE = 1e6;

    uint256 private constant _MAX_RELATIVE_ERROR = 1e16;
    uint256 private constant _MAX_BPT_PRICE = type(uint96).max;

    function testReferenceParams(
        uint256 bptPrice,
        uint256 weightComplement,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        bptPrice = bound(bptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        weightComplement = bound(weightComplement, _MINIMUM_TOKEN_WEIGHT, _MAXIMUM_TOKEN_WEIGHT);
        lowerBound = bound(lowerBound, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);
        upperBound = bound(upperBound, lowerBound, _MAX_BOUND_PERCENTAGE);

        CircuitBreakerLib.CircuitBreakerParams memory params = CircuitBreakerLib.CircuitBreakerParams({
            bptPrice: bptPrice,
            weightComplement: weightComplement,
            lowerBound: lowerBound,
            upperBound: upperBound
        });

        bytes32 poolState = CircuitBreakerLib.setCircuitBreakerFields(params);
        CircuitBreakerLib.CircuitBreakerParams memory result = CircuitBreakerLib.getCircuitBreakerFields(poolState);

        assertEq(result.bptPrice, bptPrice);
        assertEq(result.weightComplement, weightComplement);
        assertApproxEqRel(result.lowerBound, lowerBound, _MAX_RELATIVE_ERROR);
        assertApproxEqRel(result.upperBound, upperBound, _MAX_RELATIVE_ERROR);
    }

    function testReferenceBoundRatios(
        uint256 bptPrice,
        uint256 weightComplement,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        bptPrice = bound(bptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        weightComplement = bound(weightComplement, _MINIMUM_TOKEN_WEIGHT, _MAXIMUM_TOKEN_WEIGHT);
        lowerBound = bound(lowerBound, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);
        upperBound = bound(upperBound, lowerBound, _MAX_BOUND_PERCENTAGE);

        CircuitBreakerLib.CircuitBreakerParams memory params = CircuitBreakerLib.CircuitBreakerParams({
            bptPrice: bptPrice,
            weightComplement: weightComplement,
            lowerBound: lowerBound,
            upperBound: upperBound
        });

        uint256 expectedLowerBoundBptPrice = uint256(bptPrice).mulDown(lowerBound.powUp(weightComplement));
        uint256 expectedUpperBoundBptPrice = uint256(bptPrice).mulDown(upperBound.powDown(weightComplement));

        bytes32 poolState = CircuitBreakerLib.setCircuitBreakerFields(params);

        // Test that calling it with the original weightComplement retrieves exact values from the ratio cache
        (uint256 actualLowerBoundBptPrice, uint256 actualUpperBoundBptPrice) =
            CircuitBreakerLib.getCurrentCircuitBreakerBounds(poolState, weightComplement);

        assertApproxEqRel(actualLowerBoundBptPrice, expectedLowerBoundBptPrice, _MAX_RELATIVE_ERROR);
        assertApproxEqRel(actualUpperBoundBptPrice, expectedUpperBoundBptPrice, _MAX_RELATIVE_ERROR);
    }

    function testDynamicBoundRatios(
        uint256 initialBptPrice,
        uint256 initialWeightComplement,
        uint256 newWeightComplement,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        initialBptPrice = bound(initialBptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        lowerBound = bound(lowerBound, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);
        upperBound = bound(upperBound, lowerBound, _MAX_BOUND_PERCENTAGE);
        initialWeightComplement = bound(initialWeightComplement, _MINIMUM_TOKEN_WEIGHT, _MAXIMUM_TOKEN_WEIGHT);
        newWeightComplement = bound(newWeightComplement, _MINIMUM_BOUND_PERCENTAGE, FixedPoint.ONE);

        CircuitBreakerLib.CircuitBreakerParams memory params = CircuitBreakerLib.CircuitBreakerParams({
            bptPrice: initialBptPrice,
            weightComplement: initialWeightComplement,
            lowerBound: lowerBound,
            upperBound: upperBound
        });

        // Set the initial state of the breaker
        bytes32 initialPoolState = CircuitBreakerLib.setCircuitBreakerFields(params);
        (uint256 lowerBptPriceBoundary, uint256 upperBptPriceBoundary) =
            CircuitBreakerLib.getCurrentCircuitBreakerBounds(initialPoolState, newWeightComplement);

        (uint256 expectedLowerBptPrice, uint256 expectedUpperBptPrice) = CircuitBreakerLib.getBoundaryConversionRatios(
            lowerBound,
            upperBound,
            newWeightComplement
        );
        
        assertApproxEqRel(
            lowerBptPriceBoundary,
            uint256(initialBptPrice).mulDown(expectedLowerBptPrice),
            _MAX_RELATIVE_ERROR
        );
        assertApproxEqRel(
            upperBptPriceBoundary,
            uint256(initialBptPrice).mulUp(expectedUpperBptPrice),
            _MAX_RELATIVE_ERROR
        );
    }
}
