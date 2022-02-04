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

// solhint-disable not-rely-on-time

library WeightChange {
    using FixedPoint for uint256;

    enum WeightChangeMode { EQUAL_WEIGHT_CHANGE, EQUAL_PRICE_PERCENTAGE_CHANGE }

    function getNormalizedWeight(
        WeightChangeMode mode,
        uint256 startWeight,
        uint256 endWeight,
        uint256 startTime,
        uint256 endTime
    ) internal view returns (uint256) {
        if (mode == WeightChangeMode.EQUAL_WEIGHT_CHANGE) {
            return getNormalizedWeightByEqualWeightChange(startWeight, endWeight, startTime, endTime);
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    function getWeight(
        WeightChangeMode mode,
        uint256 startWeight,
        uint256 endWeight,
        uint256 startTime,
        uint256 endTime
    ) internal view returns (uint256) {
        if (mode == WeightChangeMode.EQUAL_WEIGHT_CHANGE) {
            return getNormalizedWeightByEqualWeightChange(startWeight, endWeight, startTime, endTime);
        } else if (mode == WeightChangeMode.EQUAL_PRICE_PERCENTAGE_CHANGE) {
            return getWeightByEqualPricePercentage(startWeight, endWeight, startTime, endTime);
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    function getNormalizedWeightByEqualWeightChange(
        uint256 startWeight,
        uint256 endWeight,
        uint256 startTime,
        uint256 endTime
    ) internal view returns (uint256) {
        uint256 pctProgress = _calculateWeightChangeProgress(startTime, endTime);
        return _interpolateWeight(startWeight, endWeight, pctProgress);
    }

    function getWeightByEqualPricePercentage(
        uint256 startWeight,
        uint256 endWeight,
        uint256 startTime,
        uint256 endTime
    ) internal view returns (uint256) {
        (uint256 secondsElapsed, uint256 totalSeconds) = _calculateSecondsProgress(startTime, endTime);

        if (secondsElapsed >= totalSeconds || totalSeconds == 0) return endWeight;
        if (secondsElapsed == 0) return startWeight;

        //wn = w1 *  (finalWeight / initWeight) ^ ((n-1)/(N-1))
        uint256 base = endWeight.divDown(startWeight);
        uint256 exponent = secondsElapsed.divDown(totalSeconds);
        uint256 power = base.powDown(exponent);
        return startWeight.mulDown(power);
    }

    // Private functions

    function _interpolateWeight(
        uint256 startWeight,
        uint256 endWeight,
        uint256 pctProgress
    ) private pure returns (uint256) {
        if (pctProgress == 0 || startWeight == endWeight) return startWeight;
        if (pctProgress >= FixedPoint.ONE) return endWeight;

        if (startWeight > endWeight) {
            uint256 weightDelta = pctProgress.mulDown(startWeight - endWeight);
            return startWeight.sub(weightDelta);
        } else {
            uint256 weightDelta = pctProgress.mulDown(endWeight - startWeight);
            return startWeight.add(weightDelta);
        }
    }

    /**
     * @dev Returns a fixed-point number representing how far along the current weight change is, where 0 means the
     * change has not yet started, and FixedPoint.ONE means it has fully completed.
     */
    function _calculateWeightChangeProgress(uint256 startTime, uint256 endTime) private view returns (uint256) {
        (uint256 secondsElapsed, uint256 totalSeconds) = _calculateSecondsProgress(startTime, endTime);

        if (secondsElapsed > totalSeconds || totalSeconds == 0) {
            return FixedPoint.ONE;
        } else if (secondsElapsed == 0) {
            return 0;
        }

        // Division by zero is avoided because it previously considered it completed in the degenerate case of a zero
        // duration change.
        return secondsElapsed.divDown(totalSeconds);
    }

    function _calculateSecondsProgress(uint256 startTime, uint256 endTime)
        private
        view
        returns (uint256 secondsElapsed, uint256 totalSeconds)
    {
        uint256 currentTime = block.timestamp;

        // No need for SafeMath as it was checked right above: endTime >= currentTime >= startTime
        secondsElapsed = currentTime > startTime ? currentTime - startTime : 0;
        totalSeconds = endTime > startTime ? endTime - startTime : 0;
    }
}
