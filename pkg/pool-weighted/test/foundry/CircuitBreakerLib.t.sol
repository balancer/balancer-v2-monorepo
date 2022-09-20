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
    uint256 private constant _MAX_BOUND_PERCENTAGE = 2e18; // 2.0 - should be 10.0
    uint256 private constant _MINIMUM_LOWER_BOUND = 1e16;   // 0.01
    uint256 private constant _MAX_WEIGHT_COMPLEMENT = 3.3e18;

    uint256 private constant _MAX_RELATIVE_ERROR = 1e16;
    uint256 private constant _MAX_BOUND_ERROR = 2e16;
 
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
        uint128 bptPrice,
        uint256 weightComplement,
        uint256 lowerBound,
        uint256 upperBound
    ) public {
        vm.assume(bptPrice < (1 << 112));
        weightComplement = bound(weightComplement, _MINIMUM_LOWER_BOUND, _MAX_WEIGHT_COMPLEMENT);
        lowerBound = bound(lowerBound, _MINIMUM_LOWER_BOUND, FixedPoint.ONE);
        upperBound = bound(upperBound, FixedPoint.ONE, _MAX_BOUND_PERCENTAGE);

        CircuitBreakerLib.CircuitBreakerParams memory params = CircuitBreakerLib.CircuitBreakerParams({
            referenceBptPrice: bptPrice,
            referenceWeightComplement: weightComplement,
            lowerBoundPercentage: lowerBound,
            upperBoundPercentage: upperBound
        });

        CircuitBreakerLib.CircuitBreakerParams memory result = _roundTrip(params);

        assertEq(result.referenceBptPrice, bptPrice);
        assertApproxEqRel(result.referenceWeightComplement, weightComplement, _MAX_RELATIVE_ERROR);
        assertApproxEqRel(result.lowerBoundPercentage, lowerBound, _MAX_BOUND_ERROR);
        assertApproxEqRel(result.upperBoundPercentage, upperBound, _MAX_BOUND_ERROR);
    }
}
