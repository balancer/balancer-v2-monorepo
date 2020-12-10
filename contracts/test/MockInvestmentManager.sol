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

import "../math/FixedPoint.sol";
import "../investmentManagers/InvestmentManager.sol";

contract MockInvestmentManager is InvestmentManager {
    using FixedPoint for uint128;

    constructor(IVault vault, address token) InvestmentManager(vault, token) {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Mock function to simulate investment returns
     */
    function mockIncreasePresentValue(uint128 amount) external {
        presentValue = presentValue.add128(amount);
    }

    /**
     * @dev Mock function to simulate investment losses
     */
    function mockDecreasePresentValue(uint128 amount) external {
        presentValue = presentValue.sub128(amount);
    }
}
