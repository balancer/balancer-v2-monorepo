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

contract WeightedMathJoinExitRoundingTest is Test {
    using FixedPoint for uint256;

    // Match the minimum supply defined in `BasePool`.
    uint256 private constant _DEFAULT_MINIMUM_BPT = 1e6;

    function testJoinExitGivenInGivenInNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 initialAmount,
        uint256 originalBptTotalSupply,
        uint256 swapFeePercentage
    ) external {
        originalBalance = bound(originalBalance, 1e10, type(uint112).max);
        initialAmount = bound(initialAmount, 0, originalBalance);

        normalizedWeight = bound(normalizedWeight, WeightedMath._MIN_WEIGHT, FixedPoint.ONE - WeightedMath._MIN_WEIGHT);
        originalBptTotalSupply = bound(originalBptTotalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);
        swapFeePercentage = bound(swapFeePercentage, 0, 0.95e18);

        _testJoinExitGivenInGivenInNoProfit(
            originalBalance,
            normalizedWeight,
            initialAmount,
            originalBptTotalSupply,
            swapFeePercentage
        );
    }

    function testJoinExitGivenInGivenInNoSwapFeeNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 initialAmount,
        uint256 originalBptTotalSupply
    ) external {
        originalBalance = bound(originalBalance, 1e10, type(uint112).max);
        initialAmount = bound(initialAmount, 0, originalBalance);

        normalizedWeight = bound(normalizedWeight, WeightedMath._MIN_WEIGHT, FixedPoint.ONE - WeightedMath._MIN_WEIGHT);
        originalBptTotalSupply = bound(originalBptTotalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);

        _testJoinExitGivenInGivenInNoProfit(
            originalBalance,
            normalizedWeight,
            initialAmount,
            originalBptTotalSupply,
            0
        );
    }

    function _testJoinExitGivenInGivenInNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 initialAmount,
        uint256 originalBptTotalSupply,
        uint256 swapFeePercentage
    ) private {
        // Join given a token amount in
        uint256 intermediateBptAmount = WeightedMath._calcBptOutGivenExactTokenIn(
            originalBalance,
            normalizedWeight,
            initialAmount,
            originalBptTotalSupply,
            swapFeePercentage
        );

        uint256 newBptTotalSupply = originalBptTotalSupply.add(intermediateBptAmount);
        uint256 newBalance = originalBalance.add(initialAmount);

        // Exit given BPT in
        uint256 exitInvariantRatio = newBptTotalSupply.sub(intermediateBptAmount).divUp(newBptTotalSupply);
        vm.assume(exitInvariantRatio >= WeightedMath._MIN_INVARIANT_RATIO);

        uint256 finalAmount = WeightedMath._calcTokenOutGivenExactBptIn(
            newBalance,
            normalizedWeight,
            intermediateBptAmount,
            newBptTotalSupply,
            swapFeePercentage
        );

        emit log_named_uint("originalBalance", originalBalance);
        emit log_named_uint("normalizedWeight", normalizedWeight);
        emit log_named_uint("originalBptTotalSupply", originalBptTotalSupply);
        emit log_named_uint("swapFeePercentage", swapFeePercentage);

        emit log_named_uint("initialAmount", initialAmount);
        emit log_named_uint("intermediateBptAmount", intermediateBptAmount);
        emit log_named_uint("finalAmount", finalAmount);

        // And check that we didn't get any free tokens
        assertLe(finalAmount, initialAmount);
    }

    function testJoinExitGivenInGivenOutNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 initialAmount,
        uint256 originalBptTotalSupply,
        uint256 swapFeePercentage
    ) external {
        originalBalance = bound(originalBalance, 1e10, type(uint112).max);
        initialAmount = bound(initialAmount, 0, originalBalance);

        normalizedWeight = bound(normalizedWeight, WeightedMath._MIN_WEIGHT, FixedPoint.ONE - WeightedMath._MIN_WEIGHT);
        originalBptTotalSupply = bound(originalBptTotalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);
        swapFeePercentage = bound(swapFeePercentage, 0, 0.95e18);

        _testJoinExitGivenInGivenOutNoProfit(
            originalBalance,
            normalizedWeight,
            initialAmount,
            originalBptTotalSupply,
            swapFeePercentage
        );
    }

    function testJoinExitGivenInGivenOutNoSwapFeeNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 initialAmount,
        uint256 originalBptTotalSupply
    ) external {
        originalBalance = bound(originalBalance, 1e10, type(uint112).max);
        initialAmount = bound(initialAmount, 0, originalBalance);

        normalizedWeight = bound(normalizedWeight, WeightedMath._MIN_WEIGHT, FixedPoint.ONE - WeightedMath._MIN_WEIGHT);
        originalBptTotalSupply = bound(originalBptTotalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);

        _testJoinExitGivenInGivenOutNoProfit(
            originalBalance,
            normalizedWeight,
            initialAmount,
            originalBptTotalSupply,
            0
        );
    }

    function _testJoinExitGivenInGivenOutNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 initialAmount,
        uint256 originalBptTotalSupply,
        uint256 swapFeePercentage
    ) private {
        // Join given a token amount in
        uint256 intermediateBptAmount = WeightedMath._calcBptOutGivenExactTokenIn(
            originalBalance,
            normalizedWeight,
            initialAmount,
            originalBptTotalSupply,
            swapFeePercentage
        );

        uint256 newBptTotalSupply = originalBptTotalSupply.add(intermediateBptAmount);
        uint256 newBalance = originalBalance.add(initialAmount);

        // Exit given the initial token amount out
        // This condition is a bit too strict as the fee won't be applied to the entire balance.
        vm.assume(initialAmount.divUp(swapFeePercentage.complement()) <= newBalance);
        uint256 requestedBptAmount = WeightedMath._calcBptInGivenExactTokenOut(
            newBalance,
            normalizedWeight,
            initialAmount,
            newBptTotalSupply,
            swapFeePercentage
        );

        emit log_named_uint("originalBalance", originalBalance);
        emit log_named_uint("normalizedWeight", normalizedWeight);
        emit log_named_uint("originalBptTotalSupply", originalBptTotalSupply);
        emit log_named_uint("swapFeePercentage", swapFeePercentage);

        emit log_named_uint("initialAmount", initialAmount);
        emit log_named_uint("intermediateBptAmount", intermediateBptAmount);
        emit log_named_uint("requestedBptAmount", requestedBptAmount);

        // And check that we didn't get any free tokens
        assertLe(intermediateBptAmount, requestedBptAmount);
    }

    function testJoinExitGivenOutGivenInNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 intermediateBptAmount,
        uint256 originalBptTotalSupply,
        uint256 swapFeePercentage
    ) external {
        originalBalance = bound(originalBalance, 1e10, type(uint112).max);

        normalizedWeight = bound(normalizedWeight, WeightedMath._MIN_WEIGHT, FixedPoint.ONE - WeightedMath._MIN_WEIGHT);
        originalBptTotalSupply = bound(originalBptTotalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);
        swapFeePercentage = bound(swapFeePercentage, 0, 0.95e18);

        _testJoinExitGivenOutGivenInNoProfit(
            originalBalance,
            normalizedWeight,
            intermediateBptAmount,
            originalBptTotalSupply,
            swapFeePercentage
        );
    }

    function testJoinExitGivenOutGivenInNoSwapFeeNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 intermediateBptAmount,
        uint256 originalBptTotalSupply
    ) external {
        originalBalance = bound(originalBalance, 1e10, type(uint112).max);

        normalizedWeight = bound(normalizedWeight, WeightedMath._MIN_WEIGHT, FixedPoint.ONE - WeightedMath._MIN_WEIGHT);
        originalBptTotalSupply = bound(originalBptTotalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);

        _testJoinExitGivenOutGivenInNoProfit(
            originalBalance,
            normalizedWeight,
            intermediateBptAmount,
            originalBptTotalSupply,
            0
        );
    }

    function _testJoinExitGivenOutGivenInNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 intermediateBptAmount,
        uint256 originalBptTotalSupply,
        uint256 swapFeePercentage
    ) private {
        // Join given a token amount in
        intermediateBptAmount = bound(intermediateBptAmount, 0, originalBptTotalSupply / 3); // This makes the assume reject fewer cases
        vm.assume(
            originalBptTotalSupply.add(intermediateBptAmount).divUp(originalBptTotalSupply) <=
                WeightedMath._MAX_INVARIANT_RATIO
        );

        uint256 initialAmount = WeightedMath._calcTokenInGivenExactBptOut(
            originalBalance,
            normalizedWeight,
            intermediateBptAmount,
            originalBptTotalSupply,
            swapFeePercentage
        );

        uint256 newBptTotalSupply = originalBptTotalSupply.add(intermediateBptAmount);
        uint256 newBalance = originalBalance.add(initialAmount);

        // Exit given BPT in
        uint256 exitInvariantRatio = newBptTotalSupply.sub(intermediateBptAmount).divUp(newBptTotalSupply);
        vm.assume(exitInvariantRatio >= WeightedMath._MIN_INVARIANT_RATIO);

        uint256 finalAmount = WeightedMath._calcTokenOutGivenExactBptIn(
            newBalance,
            normalizedWeight,
            intermediateBptAmount,
            newBptTotalSupply,
            swapFeePercentage
        );

        emit log_named_uint("originalBalance", originalBalance);
        emit log_named_uint("normalizedWeight", normalizedWeight);
        emit log_named_uint("originalBptTotalSupply", originalBptTotalSupply);
        emit log_named_uint("swapFeePercentage", swapFeePercentage);

        emit log_named_uint("initialAmount", initialAmount);
        emit log_named_uint("intermediateBptAmount", intermediateBptAmount);
        emit log_named_uint("finalAmount", finalAmount);

        // And check that we didn't get any free tokens
        assertLe(finalAmount, initialAmount);
    }

    function testJoinExitGivenOutGivenOutNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 intermediateBptAmount,
        uint256 originalBptTotalSupply,
        uint256 swapFeePercentage
    ) external {
        originalBalance = bound(originalBalance, 1e10, type(uint112).max);

        normalizedWeight = bound(normalizedWeight, WeightedMath._MIN_WEIGHT, FixedPoint.ONE - WeightedMath._MIN_WEIGHT);
        originalBptTotalSupply = bound(originalBptTotalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);
        swapFeePercentage = bound(swapFeePercentage, 0, 0.95e18);

        _testJoinExitGivenOutGivenOutNoProfit(
            originalBalance,
            normalizedWeight,
            intermediateBptAmount,
            originalBptTotalSupply,
            swapFeePercentage
        );
    }

    function testJoinExitGivenOutGivenOutNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 intermediateBptAmount,
        uint256 originalBptTotalSupply
    ) external {
        originalBalance = bound(originalBalance, 1e10, type(uint112).max);

        normalizedWeight = bound(normalizedWeight, WeightedMath._MIN_WEIGHT, FixedPoint.ONE - WeightedMath._MIN_WEIGHT);
        originalBptTotalSupply = bound(originalBptTotalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);

        _testJoinExitGivenOutGivenOutNoProfit(
            originalBalance,
            normalizedWeight,
            intermediateBptAmount,
            originalBptTotalSupply,
            0
        );
    }

    function _testJoinExitGivenOutGivenOutNoProfit(
        uint256 originalBalance,
        uint256 normalizedWeight,
        uint256 intermediateBptAmount,
        uint256 originalBptTotalSupply,
        uint256 swapFeePercentage
    ) private {
        // Join given a token amount in
        intermediateBptAmount = bound(intermediateBptAmount, 0, originalBptTotalSupply / 3); // This makes the assume reject fewer cases
        vm.assume(
            originalBptTotalSupply.add(intermediateBptAmount).divUp(originalBptTotalSupply) <=
                WeightedMath._MAX_INVARIANT_RATIO
        );

        uint256 initialAmount = WeightedMath._calcTokenInGivenExactBptOut(
            originalBalance,
            normalizedWeight,
            intermediateBptAmount,
            originalBptTotalSupply,
            swapFeePercentage
        );

        uint256 newBptTotalSupply = originalBptTotalSupply.add(intermediateBptAmount);
        uint256 newBalance = originalBalance.add(initialAmount);

        // Exit given the initial token amount out
        // This condition is a bit too strict as the fee won't be applied to the entire balance.
        vm.assume(initialAmount.divUp(swapFeePercentage.complement()) <= newBalance);
        uint256 requestedBptAmount = WeightedMath._calcBptInGivenExactTokenOut(
            newBalance,
            normalizedWeight,
            initialAmount,
            newBptTotalSupply,
            swapFeePercentage
        );

        emit log_named_uint("originalBalance", originalBalance);
        emit log_named_uint("normalizedWeight", normalizedWeight);
        emit log_named_uint("originalBptTotalSupply", originalBptTotalSupply);
        emit log_named_uint("swapFeePercentage", swapFeePercentage);

        emit log_named_uint("initialAmount", initialAmount);
        emit log_named_uint("intermediateBptAmount", intermediateBptAmount);
        emit log_named_uint("requestedBptAmount", requestedBptAmount);

        // And check that we didn't get any free tokens
        assertLe(intermediateBptAmount, requestedBptAmount);
    }
}
