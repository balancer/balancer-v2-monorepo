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

import "../lib/GradualValueChange.sol";

contract MockGradualValueChange {
    function getInterpolatedValue(
        uint256 startWeight,
        uint256 endWeight,
        uint256 startTime,
        uint256 endTime
    ) external view returns (uint256) {
        return GradualValueChange.getInterpolatedValue(startWeight, endWeight, startTime, endTime);
    }

    function resolveStartTime(uint256 startTime, uint256 endTime) external view returns (uint256) {
        return GradualValueChange.resolveStartTime(startTime, endTime);
    }
}
