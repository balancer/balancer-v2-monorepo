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

import "../../contracts/WeightedMath.sol";

contract WeightedMathSwapRoundingTest is Test {
    using FixedPoint for uint256;

    /**
     * @dev Performs a swap given in and then reverts it with another swap given in. The trader gets no profit.
     */
    function testRevertedSwapGivenInGivenInNoProfit(
        uint256 originalBalanceA,
        uint256 normalizedWeightA,
        uint256 originalBalanceB,
        uint256 normalizedWeightB,
        uint256 initialAmountA
    ) external {
        originalBalanceA = bound(originalBalanceA, 1e10, type(uint112).max);
        originalBalanceB = bound(originalBalanceB, 1e10, type(uint112).max);

        normalizedWeightA = bound(
            normalizedWeightA,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        normalizedWeightB = bound(
            normalizedWeightB,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        vm.assume(normalizedWeightA.add(normalizedWeightB) <= FixedPoint.ONE);

        // Send token A for B, given an amount A in
        initialAmountA = bound(initialAmountA, 0, originalBalanceA / 3); // This makes the assume reject fewer cases
        vm.assume(initialAmountA <= originalBalanceA.mulDown(WeightedMath._MAX_IN_RATIO));
        uint256 intermediateAmountB = WeightedMath._calcOutGivenIn(
            originalBalanceA,
            normalizedWeightA,
            originalBalanceB,
            normalizedWeightB,
            initialAmountA
        );

        uint256 newBalanceA = originalBalanceA.add(initialAmountA);
        uint256 newBalanceB = originalBalanceB.sub(intermediateAmountB);

        // Send the tokens B we got for A, given tokens B in
        vm.assume(intermediateAmountB <= newBalanceB.mulDown(WeightedMath._MAX_IN_RATIO));
        uint256 finalAmountA = WeightedMath._calcOutGivenIn(
            newBalanceB,
            normalizedWeightB,
            newBalanceA,
            normalizedWeightA,
            intermediateAmountB
        );

        emit log_named_uint("originalBalanceA", originalBalanceA);
        emit log_named_uint("normalizedWeightA", normalizedWeightA);
        emit log_named_uint("originalBalanceB", originalBalanceB);
        emit log_named_uint("normalizedWeightB", normalizedWeightB);

        emit log_named_uint("initialAmountA", initialAmountA);
        emit log_named_uint("intermediateAmountB", intermediateAmountB);
        emit log_named_uint("finalAmountA", finalAmountA);

        // And check that we didn't get any free tokens A
        assertLe(finalAmountA, initialAmountA);
    }

    /**
     * @dev Performs a swap given in and then reverts it with another swap given out. The trader gets no profit.
     */
    function testRevertedSwapGivenInGivenOutNoProfit(
        uint256 originalBalanceA,
        uint256 normalizedWeightA,
        uint256 originalBalanceB,
        uint256 normalizedWeightB,
        uint256 initialAmountA
    ) external {
        originalBalanceA = bound(originalBalanceA, 1e10, type(uint112).max);
        originalBalanceB = bound(originalBalanceB, 1e10, type(uint112).max);

        normalizedWeightA = bound(
            normalizedWeightA,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        normalizedWeightB = bound(
            normalizedWeightB,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        vm.assume(normalizedWeightA.add(normalizedWeightB) <= FixedPoint.ONE);

        // Send token A for B, given an amount A in
        initialAmountA = bound(initialAmountA, 0, originalBalanceA / 3); // This makes the assume reject fewer cases
        vm.assume(initialAmountA <= originalBalanceA.mulDown(WeightedMath._MAX_IN_RATIO));
        uint256 intermediateAmountB = WeightedMath._calcOutGivenIn(
            originalBalanceA,
            normalizedWeightA,
            originalBalanceB,
            normalizedWeightB,
            initialAmountA
        );

        uint256 newBalanceA = originalBalanceA.add(initialAmountA);
        uint256 newBalanceB = originalBalanceB.sub(intermediateAmountB);

        // Send token B for A, given the initial amount A out
        vm.assume(initialAmountA <= newBalanceA.mulDown(WeightedMath._MAX_OUT_RATIO));
        uint256 requestedAmountB = WeightedMath._calcInGivenOut(
            newBalanceB,
            normalizedWeightB,
            newBalanceA,
            normalizedWeightA,
            initialAmountA
        );

        emit log_named_uint("originalBalanceA", originalBalanceA);
        emit log_named_uint("normalizedWeightA", normalizedWeightA);
        emit log_named_uint("originalBalanceB", originalBalanceB);
        emit log_named_uint("normalizedWeightB", normalizedWeightB);

        emit log_named_uint("initialAmountA", initialAmountA);
        emit log_named_uint("intermediateAmountB", intermediateAmountB);
        emit log_named_uint("requestedAmountB", requestedAmountB);

        // And check that we didn't get any free tokens B
        assertLe(intermediateAmountB, requestedAmountB);
    }

    /**
     * @dev Performs a swap given out and then reverts it with another swap given in. The trader gets no profit.
     */
    function testRevertedSwapGivenOutGivenInNoProfit(
        uint256 originalBalanceA,
        uint256 normalizedWeightA,
        uint256 originalBalanceB,
        uint256 normalizedWeightB,
        uint256 intermediateAmountB
    ) external {
        originalBalanceA = bound(originalBalanceA, 1e10, type(uint112).max);
        originalBalanceB = bound(originalBalanceB, 1e10, type(uint112).max);

        normalizedWeightA = bound(
            normalizedWeightA,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        normalizedWeightB = bound(
            normalizedWeightB,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        vm.assume(normalizedWeightA.add(normalizedWeightB) <= FixedPoint.ONE);

        // Send token A for B, given an amount B out
        intermediateAmountB = bound(intermediateAmountB, 0, originalBalanceB / 3); // This makes the assume reject fewer cases
        vm.assume(intermediateAmountB <= originalBalanceB.mulDown(WeightedMath._MAX_OUT_RATIO));

        uint256 initialAmountA = WeightedMath._calcInGivenOut(
            originalBalanceA,
            normalizedWeightA,
            originalBalanceB,
            normalizedWeightB,
            intermediateAmountB
        );

        uint256 newBalanceA = originalBalanceA.add(initialAmountA);
        uint256 newBalanceB = originalBalanceB.sub(intermediateAmountB);

        // Send the tokens B we got for A, given tokens B in
        vm.assume(intermediateAmountB <= newBalanceB.mulDown(WeightedMath._MAX_IN_RATIO));
        uint256 finalAmountA = WeightedMath._calcOutGivenIn(
            newBalanceB,
            normalizedWeightB,
            newBalanceA,
            normalizedWeightA,
            intermediateAmountB
        );

        emit log_named_uint("originalBalanceA", originalBalanceA);
        emit log_named_uint("normalizedWeightA", normalizedWeightA);
        emit log_named_uint("originalBalanceB", originalBalanceB);
        emit log_named_uint("normalizedWeightB", normalizedWeightB);

        emit log_named_uint("intermediateAmountB", intermediateAmountB);
        emit log_named_uint("initialAmountA", initialAmountA);
        emit log_named_uint("finalAmountA", finalAmountA);

        // And check that we didn't get any free tokens A
        assertLe(finalAmountA, initialAmountA);
    }

    /**
     * @dev Performs a swap given out and then reverts it with another swap given out. The trader gets no profit.
     */
    function testRevertedSwapGivenOutGivenOutNoProfit(
        uint256 originalBalanceA,
        uint256 normalizedWeightA,
        uint256 originalBalanceB,
        uint256 normalizedWeightB,
        uint256 intermediateAmountB
    ) external {
        originalBalanceA = bound(originalBalanceA, 1e10, type(uint112).max);
        originalBalanceB = bound(originalBalanceB, 1e10, type(uint112).max);

        normalizedWeightA = bound(
            normalizedWeightA,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        normalizedWeightB = bound(
            normalizedWeightB,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        vm.assume(normalizedWeightA.add(normalizedWeightB) <= FixedPoint.ONE);

        // Send token A for B, given an amount B out
        intermediateAmountB = bound(intermediateAmountB, 0, originalBalanceB / 3); // This makes the assume reject fewer cases
        vm.assume(intermediateAmountB <= originalBalanceB.mulDown(WeightedMath._MAX_OUT_RATIO));

        uint256 initialAmountA = WeightedMath._calcInGivenOut(
            originalBalanceA,
            normalizedWeightA,
            originalBalanceB,
            normalizedWeightB,
            intermediateAmountB
        );

        uint256 newBalanceA = originalBalanceA.add(initialAmountA);
        uint256 newBalanceB = originalBalanceB.sub(intermediateAmountB);

        // Send the tokens B we got for A, given tokens the initial amount A out
        vm.assume(initialAmountA <= newBalanceA.mulDown(WeightedMath._MAX_OUT_RATIO));
        uint256 requestedAmountB = WeightedMath._calcInGivenOut(
            newBalanceB,
            normalizedWeightB,
            newBalanceA,
            normalizedWeightA,
            initialAmountA
        );

        emit log_named_uint("originalBalanceA", originalBalanceA);
        emit log_named_uint("normalizedWeightA", normalizedWeightA);
        emit log_named_uint("originalBalanceB", originalBalanceB);
        emit log_named_uint("normalizedWeightB", normalizedWeightB);

        emit log_named_uint("intermediateAmountB", intermediateAmountB);
        emit log_named_uint("initialAmountA", initialAmountA);
        emit log_named_uint("requestedAmountB", requestedAmountB);

        // And check that we didn't get any free tokens B
        assertLe(intermediateAmountB, requestedAmountB);
    }
}
