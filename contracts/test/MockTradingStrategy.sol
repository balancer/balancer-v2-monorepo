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

pragma solidity 0.7.1;
pragma experimental ABIEncoderV2;

import "../strategies/IPairTradingStrategy.sol";
import "../strategies/ITupleTradingStrategy.sol";

contract MockTradingStrategy is IPairTradingStrategy, ITupleTradingStrategy {
    function validatePair(
        ITradingStrategy.Swap calldata,
        uint128,
        uint128
    ) external override pure returns (bool, uint128) {
        return (true, 0);
    }

    function validateTuple(
        ITradingStrategy.Swap calldata,
        uint256[] calldata,
        uint256,
        uint256
    ) external override pure returns (bool, uint128) {
        return (true, 0);
    }
}
