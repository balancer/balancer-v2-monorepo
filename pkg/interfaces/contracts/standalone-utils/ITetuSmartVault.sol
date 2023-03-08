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

pragma solidity >=0.7.0 <0.9.0;

import "../solidity-utils/openzeppelin/IERC20.sol";

interface ITetuSmartVault is IERC20 {
    function deposit(uint256 amount) external;

    function depositFor(uint256 amount, address holder) external;

    function underlyingBalanceInVault() external view returns (uint256);

    function withdraw(uint256 numberOfShares) external;

    function underlyingBalanceWithInvestmentForHolder(address holder) external view returns (uint256);

    function underlying() external view returns (address);

    function underlyingUnit() external view returns (uint256);

    function getPricePerFullShare() external view returns (uint256);

    function strategy() external view returns (address);
}
