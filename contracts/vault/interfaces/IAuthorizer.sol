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

pragma solidity ^0.7.1;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAuthorizer {
    function validateCanChangeAuthorizer(address account) external view;

    function validateCanSetProtocolFees(address account) external view;

    function validateCanWithdrawCollectedFees(address account, IERC20 token) external view;

    function canChangeAuthorizer(address account) external view returns (bool);

    function canSetProtocolFees(address account) external view returns (bool);

    function canWithdrawCollectedFees(address account, IERC20 token) external view returns (bool);
}
