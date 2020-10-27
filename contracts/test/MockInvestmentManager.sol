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
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../vault/IVault.sol";
import "../investmentManagers/InvestmentManager.sol";
import "../math/FixedPoint.sol";

contract MockInvestmentManager is InvestmentManager {
    using FixedPoint for uint128;
    using SafeCast for uint256;

    constructor(IVault vault, address token) InvestmentManager(vault, token) {}

    // Mock function to simulate investment returns
    function mockIncreasePresentValue(uint128 amount) external {
        presentValue = presentValue.add128(amount);
    }

    // Example functions that an InvestmentManager would use
    // to get a return on their capital

    // transfers capital out, for invesment
    function sow(uint128 amount) public {
        // TODO depends on implementation
        cash -= amount;

        // Do something with the tokens
        // ie. IERC20(token).transfer(somewhere);
    }

    // calls capital back in from investments
    function reap(uint128 amount) public {
        // TODO depends on implementation

        // Turn investment into cash
        // uint128 unaccountedForProfit = IERC20(_token).balanceOf(address(this)).toUint128().sub128(cash);
        //presentValue = presentValue.mul128(total.add128(amount)).div128(total);

        cash += amount;
    }
}
