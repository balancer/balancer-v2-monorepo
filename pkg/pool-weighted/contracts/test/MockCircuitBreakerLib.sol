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

import "../managed/CircuitBreakerStorageLib.sol";
import "../lib/CircuitBreakerLib.sol";

contract MockCircuitBreakerLib {
    using FixedPoint for uint256;

    function getCircuitBreakerFields(bytes32 circuitBreakerState)
        external
        pure
        returns (uint256 bptPrice, uint256 weightComplement, uint256 lowerBound, uint256 upperBound)
    {
            return CircuitBreakerStorageLib.getCircuitBreakerFields(circuitBreakerState);
    }

    function getCurrentCircuitBreakerBounds(bytes32 circuitBreakerState, uint256 currentWeightFactor)
        external
        pure
        returns (uint256, uint256)
    {
        return CircuitBreakerStorageLib.getCurrentCircuitBreakerBounds(circuitBreakerState, currentWeightFactor);
    }

    function hasCircuitBreakerTripped(
        bytes32 circuitBreakerState,
        uint256 virtualSupply,
        uint256 normalizedWeight,
        uint256 upscaledBalance
    ) external pure returns (bool, bool) {
        (uint256 lowerBoundBptPrice, uint256 upperBoundBptPrice) = CircuitBreakerStorageLib.getCurrentCircuitBreakerBounds(
            circuitBreakerState,
            normalizedWeight.complement()
        );

        return
            CircuitBreakerLib.hasCircuitBreakerTripped(
                virtualSupply,
                normalizedWeight,
                upscaledBalance,
                lowerBoundBptPrice,
                upperBoundBptPrice
            );
    }

    function setCircuitBreaker(uint256 bptPrice, uint256 weightComplement, uint256 lowerBound, uint256 upperBound)
        external
        pure
        returns (bytes32)
    {
        return CircuitBreakerStorageLib.setCircuitBreaker(bptPrice, weightComplement, lowerBound, upperBound);
    }

    function updateBoundRatios(bytes32 circuitBreakerState, uint256 weightComplement) external pure returns (bytes32) {
        return CircuitBreakerStorageLib.updateBoundRatios(circuitBreakerState, weightComplement);
    }

    function calcBoundaryConversionRatios(
        uint256 lowerBoundPercentage,
        uint256 upperBoundPercentage,
        uint256 currentWeightComplement
    ) external pure returns (uint256, uint256) {
        return CircuitBreakerLib.calcBoundaryConversionRatios(
            lowerBoundPercentage,
            upperBoundPercentage,
            currentWeightComplement
        );
    }
}
