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
    function canChangeAuthorizer(address account) external view returns (bool);

    function canSetProtocolWithdrawFee(address account) external view returns (bool);

    function canSetProtocolSwapFee(address account) external view returns (bool);

    function canSetProtocolFlashLoanFee(address account) external view returns (bool);

    function canCollectProtocolFees(address account, IERC20 token) external view returns (bool);

    function canAddUniversalAgent(address account) external view returns (bool);

    function canRemoveUniversalAgent(address account) external view returns (bool);
}
