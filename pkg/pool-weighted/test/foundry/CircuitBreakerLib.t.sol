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

import "../../contracts/test/MockCircuitBreakerLib.sol";
import "../../contracts/lib/CircuitBreakerLib.sol";

contract CircuitBreakerLibTest is Test {
    using FixedPoint for uint256;

    uint256 private constant _MAX_BOUND_PERCENTAGE = 2e18; // 2.0 (max uncompressed is 10)
    uint256 private constant _MINIMUM_LOWER_BOUND = 1e17;  // 0.1
    uint256 private constant _MAX_WEIGHT_COMPLEMENT = 3.3e18;
    uint256 private constant _MIN_BPT_PRICE = 1e6;

    uint256 private constant _MAX_RELATIVE_ERROR = 1e16;
    uint256 private constant _MAX_BOUND_ERROR = 2e16;
    uint256 private constant _MAX_BPT_PRICE = type(uint112).max;
 
    uint256 private constant _NUM_WEIGHT_TRIALS = 10;

    MockCircuitBreakerLib private _mock;

    function setUp() external {
        _mock = new MockCircuitBreakerLib();
    }

    function _roundTrip(CircuitBreakerLib.CircuitBreakerParams memory params)
        private
        view
        returns (CircuitBreakerLib.CircuitBreakerParams memory)
    {
        // The setter overwrites all state, so the previous state doesn't matter
        // If we find we need to set fields individually (e.g., only the bounds),
        // we could add tests that the previous state was not altered.
        bytes32 newPoolState = _mock.setCircuitBreakerFields(bytes32(0), params);

        return _mock.getCircuitBreakerFields(newPoolState);
    }

    function testCircuitBreakerPrice(
        uint256 refBptPrice,
        uint256 weightComplement,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        refBptPrice = bound(refBptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        weightComplement = bound(weightComplement, _MINIMUM_LOWER_BOUND, _MAX_WEIGHT_COMPLEMENT);
        lowerBound = bound(lowerBound, _MINIMUM_LOWER_BOUND, FixedPoint.ONE);
        upperBound = bound(upperBound, FixedPoint.ONE, _MAX_BOUND_PERCENTAGE);

        CircuitBreakerLib.CircuitBreakerParams memory params = CircuitBreakerLib.CircuitBreakerParams({
            referenceBptPrice: refBptPrice,
            referenceWeightComplement: weightComplement,
            lowerBoundPercentage: lowerBound,
            upperBoundPercentage: upperBound
        });

        CircuitBreakerLib.CircuitBreakerParams memory result = _roundTrip(params);

        assertEq(result.referenceBptPrice, refBptPrice);
        assertApproxEqRel(result.referenceWeightComplement, weightComplement, _MAX_RELATIVE_ERROR);
        assertApproxEqRel(result.lowerBoundPercentage, lowerBound, _MAX_BOUND_ERROR);
        assertApproxEqRel(result.upperBoundPercentage, upperBound, _MAX_BOUND_ERROR);

        bytes32 initialPoolState = _mock.setCircuitBreakerFields(bytes32(0), params);
        (uint256 initialLowerBptPriceBoundary, uint256 initialUpperBptPriceBoundary) =
            _mock.getCurrentCircuitBreakerBounds(initialPoolState, weightComplement);

        uint256 expectedLowerBoundBptPrice = uint256(refBptPrice).mulDown(lowerBound.powDown(weightComplement));
        uint256 expectedUpperBoundBptPrice = uint256(refBptPrice).mulDown(upperBound.powUp(weightComplement));

        assertApproxEqRel(initialLowerBptPriceBoundary, expectedLowerBoundBptPrice, _MAX_RELATIVE_ERROR);
        assertApproxEqRel(initialUpperBptPriceBoundary, expectedUpperBoundBptPrice, _MAX_RELATIVE_ERROR);

        // Test that calling it with the original weightComplement retrieves exact values from the ratio cache
        (uint256 cachedLowerBptPriceBoundary, uint256 cachedUpperBptPriceBoundary) =
            _mock.getCurrentCircuitBreakerBounds(initialPoolState, weightComplement);

        assertEq(cachedLowerBptPriceBoundary, initialLowerBptPriceBoundary);
        assertEq(cachedUpperBptPriceBoundary, initialUpperBptPriceBoundary);
    }

    function testCircuitBreakerBounds(
        uint256 refBptPrice,
        uint256 initialWeightComplement,
        uint256 newWeightComplement,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        // With refBptPrice ~ 0, rounding errors make it fail
        refBptPrice = bound(refBptPrice, _MIN_BPT_PRICE, _MAX_BPT_PRICE);
        lowerBound = bound(lowerBound, _MINIMUM_LOWER_BOUND, FixedPoint.ONE);
        upperBound = bound(upperBound, FixedPoint.ONE, _MAX_BOUND_PERCENTAGE);
        initialWeightComplement = bound(initialWeightComplement, _MINIMUM_LOWER_BOUND, _MAX_WEIGHT_COMPLEMENT);
        newWeightComplement = bound(newWeightComplement, _MINIMUM_LOWER_BOUND, _MAX_WEIGHT_COMPLEMENT);

        CircuitBreakerLib.CircuitBreakerParams memory params = CircuitBreakerLib.CircuitBreakerParams({
            referenceBptPrice: refBptPrice,
            referenceWeightComplement: initialWeightComplement,
            lowerBoundPercentage: lowerBound,
            upperBoundPercentage: upperBound
        });

        // Set the initial state of the breaker
        bytes32 initialPoolState = _mock.setCircuitBreakerFields(bytes32(0), params);
        (uint256 lowerBptPriceBoundary, uint256 upperBptPriceBoundary) =
            _mock.getCurrentCircuitBreakerBounds(initialPoolState, newWeightComplement);

        _validateWithNewComplement(
            refBptPrice,
            lowerBound,
            upperBound,
            lowerBptPriceBoundary,
            upperBptPriceBoundary,
            newWeightComplement
        );
    }

    // Needed to avoid stack-too-deep issues
    function _validateWithNewComplement(
        uint256 refBptPrice,
        uint256 lowerBound,
        uint256 upperBound,
        uint256 lowerBptPriceBoundary,
        uint256 upperBptPriceBoundary,
        uint256 newWeightComplement
    ) private {
        (uint256 expectedLowerBptPrice, uint256 expectedUpperBptPrice) = _mock.getBoundaryConversionRatios(
            lowerBound,
            upperBound,
            newWeightComplement
        );
        
        assertApproxEqRel(
            lowerBptPriceBoundary,
            uint256(refBptPrice).mulDown(expectedLowerBptPrice),
            _MAX_RELATIVE_ERROR
        );
        assertApproxEqRel(
            upperBptPriceBoundary,
            uint256(refBptPrice).mulUp(expectedUpperBptPrice),
            _MAX_RELATIVE_ERROR
        );
    }
}
