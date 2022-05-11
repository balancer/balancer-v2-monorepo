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

// https://github.com/buttonwood-protocol/button-wrappers/blob/main/contracts/UnbuttonToken.sol

pragma solidity ^0.7.0;

import "@balancer-labs/v2-interfaces/contracts/pool-linear/IAToken.sol";

import "./MockUnbuttonERC20.sol";

contract MockAaveAMPLToken is MockUnbuttonERC20, IAToken {
     constructor(
        address underlying_,
        string memory name_,
        string memory symbol_
    ) MockUnbuttonERC20(underlying_, name_, symbol_) { }

    function UNDERLYING_ASSET_ADDRESS() external view override returns (address) {
        return _underlying;
    }
}
