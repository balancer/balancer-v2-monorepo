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

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

pragma solidity ^0.7.0;

// solhint-disable not-rely-on-time

library GradualValueChange {
    using FixedPoint for uint256;

    function getInterpolatedValue(
        uint256 startValue,
        uint256 endValue,
        uint256 startTime,
        uint256 endTime
    ) internal view returns (uint256) {
        uint256 pctProgress = calculateValueChangeProgress(startTime, endTime);

        return interpolateValue(startValue, endValue, pctProgress);
    }

    function resolveStartTime(uint256 startTime, uint256 endTime) internal view returns (uint256 resolvedStartTime) {
        // If the start time is in the past, "fast forward" to start now
        // This avoids discontinuities in the value curve. Otherwise, if you set the start/end times with
        // only 10% of the period in the future, the value would immediately jump 90%
        resolvedStartTime = Math.max(block.timestamp, startTime);

        _require(resolvedStartTime <= endTime, Errors.GRADUAL_UPDATE_TIME_TRAVEL);
    }

    function interpolateValue(
        uint256 startValue,
        uint256 endValue,
        uint256 pctProgress
    ) internal pure returns (uint256) {
        if (pctProgress >= FixedPoint.ONE || startValue == endValue) return endValue;
        if (pctProgress == 0) return startValue;

        if (startValue > endValue) {
            uint256 delta = pctProgress.mulDown(startValue - endValue);
            return startValue - delta;
        } else {
            uint256 delta = pctProgress.mulDown(endValue - startValue);
            return startValue + delta;
        }
    }

    /**
     * @dev Returns a fixed-point number representing how far along the current value change is, where 0 means the
     * change has not yet started, and FixedPoint.ONE means it has fully completed.
     */
    function calculateValueChangeProgress(uint256 startTime, uint256 endTime) internal view returns (uint256) {
        if (block.timestamp >= endTime) {
            return FixedPoint.ONE;
        } else if (block.timestamp <= startTime) {
            return 0;
        }

        // No need for SafeMath as it was checked right above: endTime > block.timestamp > startTime
        uint256 totalSeconds = endTime - startTime;
        uint256 secondsElapsed = block.timestamp - startTime;

        // We don't need to consider zero division here as this is covered above.
        return secondsElapsed.divDown(totalSeconds);
    }
}
