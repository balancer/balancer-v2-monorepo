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

interface IBalancerToken is IERC20 {
    function mint(address to, uint256 amount) external;

    function getRoleMemberCount(bytes32 role) external view returns (uint256);

    function getRoleMember(bytes32 role, uint256 index) external view returns (address);

    function hasRole(bytes32 role, address account) external view returns (bool);

    function getRoleAdmin(bytes32 role) external view returns (bytes32);

    function grantRole(bytes32 role, address account) external;

    function revokeRole(bytes32 role, address account) external;

    // solhint-disable-next-line func-name-mixedcase
    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);

    // solhint-disable-next-line func-name-mixedcase
    function MINTER_ROLE() external view returns (bytes32);

    // solhint-disable-next-line func-name-mixedcase
    function SNAPSHOT_ROLE() external view returns (bytes32);

    function snapshot() external;
}
