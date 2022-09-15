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

import "../helpers/ScalingHelpers.sol";

contract MockScalingHelpers {
    function upscale(uint256 amount, uint256 scalingFactor) external pure returns (uint256) {
        return _upscale(amount, scalingFactor);
    }

    function upscaleArray(uint256[] memory amounts, uint256[] memory scalingFactors)
        external
        pure
        returns (uint256[] memory)
    {
        _upscaleArray(amounts, scalingFactors);
        return amounts;
    }

    function downscaleDown(uint256 amount, uint256 scalingFactor) external pure returns (uint256) {
        return _downscaleDown(amount, scalingFactor);
    }

    function downscaleDownArray(uint256[] memory amounts, uint256[] memory scalingFactors)
        external
        pure
        returns (uint256[] memory)
    {
        _downscaleDownArray(amounts, scalingFactors);
        return amounts;
    }

    function downscaleUp(uint256 amount, uint256 scalingFactor) external pure returns (uint256) {
        return _downscaleUp(amount, scalingFactor);
    }

    function downscaleUpArray(uint256[] memory amounts, uint256[] memory scalingFactors)
        external
        pure
        returns (uint256[] memory)
    {
        _downscaleUpArray(amounts, scalingFactors);
        return amounts;
    }
}
