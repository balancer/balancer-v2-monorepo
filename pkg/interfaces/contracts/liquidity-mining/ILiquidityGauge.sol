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

// For compatibility, we're keeping the same function names as in the original Curve code, including the mixed-case
// naming convention.
// solhint-disable func-name-mixedcase
// solhint-disable func-param-name-mixedcase

interface ILiquidityGauge {
    // solhint-disable-next-line var-name-mixedcase
    event MaxRelativeWeightChanged(uint256 indexed new_max_relative_weight);

    function integrate_fraction(address user) external view returns (uint256);

    function user_checkpoint(address user) external returns (bool);

    function is_killed() external view returns (bool);

    function killGauge() external;

    function unkillGauge() external;

    function set_max_relative_weight(uint256 maxRelativeWeight) external;

    function get_capped_relative_weight(uint256 time) external view returns (uint256);

    function get_current_capped_relative_weight() external view returns (uint256);

    function get_absolute_max_relative_weight() external pure returns (uint256);
}
