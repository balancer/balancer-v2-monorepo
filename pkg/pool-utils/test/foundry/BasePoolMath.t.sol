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
pragma experimental ABIEncoderV2;

import { Test } from "forge-std/Test.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "../../contracts/lib/BasePoolMath.sol";

contract BasePoolMathJoinExitRoundingTest is Test {
    using FixedPoint for uint256;

    // Match the minimum supply defined in `BasePool`.
    uint256 private constant _DEFAULT_MINIMUM_BPT = 1e6;

    function testJoinExitProportionalNoProfit(
        uint256[20] memory balancesFixed,
        uint256 arrayLength,
        uint256 bptAmount,
        uint256 originalBptTotalSupply
    ) external {
        arrayLength = bound(arrayLength, 2, 20);

        uint256[] memory balances = new uint256[](arrayLength);
        for (uint256 i = 0; i < arrayLength; i++) {
            balances[i] = bound(balancesFixed[i], 0, type(uint112).max);
        }

        originalBptTotalSupply = bound(originalBptTotalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);
        // We can't have arbitrarily large bptAmounts as that could cause for the amount / supply ratio to be too high
        // and result in mul overflow errors. We therefore limit this to 1e16 times the supply, which exceeds by a
        // huge margin any realistic usage.
        bptAmount = bound(bptAmount, 0, originalBptTotalSupply * 1e16);
        emit log_named_uint("originalBptTotalSupply", originalBptTotalSupply);

        // Join given a BPT amount out
        uint256[] memory amountsIn = BasePoolMath.computeProportionalAmountsIn(
            balances,
            originalBptTotalSupply,
            bptAmount
        );

        uint256 newBptTotalSupply = originalBptTotalSupply.add(bptAmount);
        uint256[] memory newBalances = new uint256[](arrayLength);
        for (uint256 i = 0; i < arrayLength; i++) {
            newBalances[i] = balances[i].add(amountsIn[i]);
        }

        // Exit given a BPT amount in

        uint256[] memory amountsOut = BasePoolMath.computeProportionalAmountsOut(
            newBalances,
            newBptTotalSupply,
            bptAmount
        );

        // And check that we didn't get any free tokens
        for (uint256 i = 0; i < arrayLength; ++i) {
            assertLe(amountsOut[i], amountsIn[i]);
        }
    }
}
