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

contract WeightedMathTest is Test {
    using FixedPoint for uint256;

    // Match the minimum supply defined in `BasePool`.
    uint256 private constant _DEFAULT_MINIMUM_BPT = 1e6;

    function testJoinSwaps(
        uint256[20] memory balancesFixed,
        uint256[20] memory normalizedWeightsFixed,
        uint256 arrayLength,
        uint256 tokenIndex,
        uint256 amountIn,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) external {
        arrayLength = bound(arrayLength, 2, 20);
        tokenIndex = bound(tokenIndex, 0, arrayLength - 1);

        uint256[] memory balances = new uint256[](arrayLength);
        for (uint256 i = 0; i < arrayLength; i++) {
            // Zero balances are not possible, as they make the invariant equal zero.
            balances[i] = bound(balancesFixed[i], 1, type(uint96).max);
        }

        uint256 denormalizedWeightSum;
        for (uint256 i = 0; i < arrayLength; i++) {
            normalizedWeightsFixed[i] = bound(normalizedWeightsFixed[i], 1, type(uint64).max);
            denormalizedWeightSum += normalizedWeightsFixed[i];
        }

        uint256[] memory normalizedWeights = new uint256[](arrayLength);
        uint256 normalizedWeightSum;
        for (uint256 i = 0; i < arrayLength; i++) {
            normalizedWeights[i] = normalizedWeightsFixed[i].divDown(denormalizedWeightSum);
            vm.assume(normalizedWeights[i] >= WeightedMath._MIN_WEIGHT);
            normalizedWeightSum += normalizedWeights[i];
        }

        // Note: Due to compression errors, this normalization property of weights may not always hold.
        // This causes the two forms of join to produce slightly different outputs due to
        // `WeightedMath._calcBptOutGivenExactTokenIn` assuming perfect normalization.
        // We therefore adjust the last weight to produce a scenario in which the two functions should match exactly.
        if (normalizedWeightSum < FixedPoint.ONE) {
            normalizedWeights[arrayLength - 1] += FixedPoint.ONE - normalizedWeightSum;
        }

        amountIn = bound(amountIn, 0, balances[tokenIndex]);
        // The Vault constrains all balances (including BPT) to 112 bits.
        bptTotalSupply = bound(bptTotalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);
        // `_calcTokenInGivenExactBptOut` and other functions divide by the complement of swapFeePercentage,
        // so a value of exactly 1 would revert with ZERO_DIVISION.
        swapFeePercentage = bound(swapFeePercentage, 0, FixedPoint.ONE - 1);

        uint256[] memory amountsIn = new uint256[](balances.length);
        amountsIn[tokenIndex] = amountIn;

        emit log_named_array("balances", balances);
        emit log_named_array("normalizedWeights", normalizedWeights);
        emit log_named_array("amountsIn", amountsIn);
        emit log_named_uint("bptTotalSupply", bptTotalSupply);
        emit log_named_uint("swapFeePercentage", swapFeePercentage);

        uint256 properJoin = WeightedMath._calcBptOutGivenExactTokensIn(
            balances,
            normalizedWeights,
            amountsIn,
            bptTotalSupply,
            swapFeePercentage
        );

        uint256 joinSwap = WeightedMath._calcBptOutGivenExactTokenIn(
            balances[tokenIndex],
            normalizedWeights[tokenIndex],
            amountsIn[tokenIndex],
            bptTotalSupply,
            swapFeePercentage
        );

        // As we're enforcing strict normalization we check for a strict equality here.
        // If we relax this condition then we can only check for an approximate equality.
        assertEq(joinSwap, properJoin);
    }

    function testExitSwaps(
        uint256[20] memory balancesFixed,
        uint256[20] memory normalizedWeightsFixed,
        uint256 arrayLength,
        uint256 tokenIndex,
        uint256 amountOut,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) external {
        arrayLength = bound(arrayLength, 2, 20);
        tokenIndex = bound(tokenIndex, 0, arrayLength - 1);

        uint256[] memory balances = new uint256[](arrayLength);
        for (uint256 i = 0; i < arrayLength; i++) {
            balances[i] = bound(balancesFixed[i], 1e12, type(uint96).max);
        }

        uint256 denormalizedWeightSum;
        for (uint256 i = 0; i < arrayLength; i++) {
            normalizedWeightsFixed[i] = bound(normalizedWeightsFixed[i], 1, type(uint64).max);
            denormalizedWeightSum += normalizedWeightsFixed[i];
        }

        uint256[] memory normalizedWeights = new uint256[](arrayLength);
        uint256 normalizedWeightSum;
        for (uint256 i = 0; i < arrayLength; i++) {
            normalizedWeights[i] = normalizedWeightsFixed[i].divDown(denormalizedWeightSum);
            vm.assume(normalizedWeights[i] >= WeightedMath._MIN_WEIGHT);
            normalizedWeightSum += normalizedWeights[i];
        }

        // Note: Due to compression errors, this normalization property of weights may not always hold. This causes the
        // two forms of exit to produce slightly different outputs due to `WeightedMath._calcBptInGivenExactTokenOut`
        // assuming perfect normalization.
        // We therefore adjust the last weight to produce a scenario in which the two functions should yield the same
        // exact result.
        if (normalizedWeightSum < FixedPoint.ONE) {
            normalizedWeights[arrayLength - 1] += FixedPoint.ONE - normalizedWeightSum;
        }

        bptTotalSupply = bound(bptTotalSupply, _DEFAULT_MINIMUM_BPT, type(uint112).max);
        swapFeePercentage = bound(swapFeePercentage, 0, 0.99e18);

        // This exit type is special in that fees are charged on the amount out. This creates scenarios in which the
        // total amount out (including fees) exceeds the Pool's balance, which will lead to reverts. We reject any runs
        // that result in this edge case.
        amountOut = bound(amountOut, 0, balances[tokenIndex].mulDown(FixedPoint.ONE - swapFeePercentage));

        uint256[] memory amountsOut = new uint256[](balances.length);
        amountsOut[tokenIndex] = amountOut;

        emit log_named_array("balances", balances);
        emit log_named_array("normalizedWeights", normalizedWeights);
        emit log_named_array("amountsOut", amountsOut);
        emit log_named_uint("bptTotalSupply", bptTotalSupply);
        emit log_named_uint("swapFeePercentage", swapFeePercentage);

        uint256 properExit = WeightedMath._calcBptInGivenExactTokensOut(
            balances,
            normalizedWeights,
            amountsOut,
            bptTotalSupply,
            swapFeePercentage
        );

        uint256 exitSwap = WeightedMath._calcBptInGivenExactTokenOut(
            balances[tokenIndex],
            normalizedWeights[tokenIndex],
            amountsOut[tokenIndex],
            bptTotalSupply,
            swapFeePercentage
        );

        // As we're enforcing strict normalization we check for a strict equality here.
        // If we relax this condition then we can only check for an approximate equality.
        assertEq(exitSwap, properExit);
    }
}
