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

import "@balancer-labs/v2-solidity-utils/contracts/test/MockLogCompression.sol";

import "../../meta/StableOracleMath.sol";

contract MockStableOracleMath is StableOracleMath, MockLogCompression {
    function calcLogSpotPrice(
        uint256 amplificationParameter,
        uint256[] memory balances
    ) external pure returns (int256) {
        uint256 spotPrice = StableOracleMath._calcSpotPrice(amplificationParameter, balances[0], balances[1]);
        return LogCompression.toLowResLog(spotPrice);
    }

    function calcLogBptPrice(
        uint256 amplificationParameter,
        uint256[] memory balances,
        int256 bptTotalSupplyLn
    ) external pure returns (int256) {
        uint256 spotPrice = StableOracleMath._calcSpotPrice(amplificationParameter, balances[0], balances[1]);
        return StableOracleMath._calcLogBptPrice(spotPrice, balances[0], balances[1], bptTotalSupplyLn);
    }
}
