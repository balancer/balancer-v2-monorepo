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

import "../solidity-utils/openzeppelin/IERC20.sol";

import "./IAuthorizerAdaptor.sol";
import "./IVotingEscrow.sol";

// For compatibility, we're keeping the same function names as in the original Curve code, including the mixed-case
// naming convention.
// solhint-disable func-name-mixedcase

interface IGaugeController {
    function checkpoint_gauge(address gauge) external;

    function gauge_relative_weight(address gauge, uint256 time) external returns (uint256);

    function voting_escrow() external view returns (IVotingEscrow);

    function token() external view returns (IERC20);

    function add_type(string calldata name, uint256 weight) external;

    function change_type_weight(int128 typeId, uint256 weight) external;

    // Gauges are to be added with zero initial weight so the full signature is not required
    function add_gauge(address gauge, int128 gaugeType) external;

    function n_gauge_types() external view returns (int128);

    function gauge_types(address gauge) external view returns (int128);

    function admin() external view returns (IAuthorizerAdaptor);
}
