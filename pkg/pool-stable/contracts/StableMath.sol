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

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

// These functions start with an underscore, as if they were part of a contract and not a library. At some point this
// should be fixed. Additionally, some variables have non mixed case names (e.g. P_D) that relate to the mathematical
// derivations.
// solhint-disable private-vars-leading-underscore, var-name-mixedcase

library StableMath {
    using FixedPoint for uint256;

    uint256 internal constant _MIN_AMP = 1;
    uint256 internal constant _MAX_AMP = 5000;
    uint256 internal constant _AMP_PRECISION = 1e3;

    uint256 internal constant _MAX_STABLE_TOKENS = 5;

    // Note on unchecked arithmetic:
    // This contract performs a large number of additions, subtractions, multiplications and divisions, often inside
    // loops. Since many of these operations are gas-sensitive (as they happen e.g. during a swap), it is important to
    // not make any unnecessary checks. We rely on a set of invariants to avoid having to use checked arithmetic (the
    // Math library), including:
    //  - the number of tokens is bounded by _MAX_STABLE_TOKENS
    //  - the amplification parameter is bounded by _MAX_AMP * _AMP_PRECISION, which fits in 23 bits
    //  - the token balances are bounded by 2^112 (guaranteed by the Vault) times 1e18 (the maximum scaling factor),
    //    which fits in 172 bits
    //
    // This means e.g. we can safely multiply a balance by the amplification parameter without worrying about overflow.

    // About swap fees on joins and exits:
    // Any join or exit that is not perfectly balanced (e.g. all single token joins or exits) is mathematically
    // equivalent to a perfectly balanced join or  exit followed by a series of swaps. Since these swaps would charge
    // swap fees, it follows that (some) joins and exits should as well.
    // On these operations, we split the token amounts in 'taxable' and 'non-taxable' portions, where the 'taxable' part
    // is the one to which swap fees are applied.

    // Computes the invariant given the current balances, using the Newton-Raphson approximation.
    // The amplification parameter equals: A n^(n-1)
    function _calculateInvariant(
        uint256 amplificationParameter,
        uint256[] memory balances,
        bool roundUp
    ) internal pure returns (uint256) {
        /**********************************************************************************************
        // invariant                                                                                 //
        // D = invariant                                                  D^(n+1)                    //
        // A = amplification coefficient      A  n^n S + D = A D n^n + -----------                   //
        // S = sum of balances                                             n^n P                     //
        // P = product of balances                                                                   //
        // n = number of tokens                                                                      //
        **********************************************************************************************/

        // We support rounding up or down.

        uint256 sum = 0;
        uint256 numTokens = balances.length;
        for (uint256 i = 0; i < numTokens; i++) {
            sum = sum.add(balances[i]);
        }
        if (sum == 0) {
            return 0;
        }

        uint256 prevInvariant = 0;
        uint256 invariant = sum;
        uint256 ampTimesTotal = amplificationParameter * numTokens;

        for (uint256 i = 0; i < 255; i++) {
            uint256 P_D = balances[0] * numTokens;
            for (uint256 j = 1; j < numTokens; j++) {
                P_D = Math.div(Math.mul(Math.mul(P_D, balances[j]), numTokens), invariant, roundUp);
            }
            prevInvariant = invariant;
            invariant = Math.div(
                Math.mul(Math.mul(numTokens, invariant), invariant).add(
                    Math.div(Math.mul(Math.mul(ampTimesTotal, sum), P_D), _AMP_PRECISION, roundUp)
                ),
                Math.mul(numTokens + 1, invariant).add(
                    // No need to use checked arithmetic for the amp precision, the amp is guaranteed to be at least 1
                    Math.div(Math.mul(ampTimesTotal - _AMP_PRECISION, P_D), _AMP_PRECISION, !roundUp)
                ),
                roundUp
            );

            if (invariant > prevInvariant) {
                if (invariant - prevInvariant <= 1) {
                    return invariant;
                }
            } else if (prevInvariant - invariant <= 1) {
                return invariant;
            }
        }

        _revert(Errors.STABLE_INVARIANT_DIDNT_CONVERGE);
    }

    // Computes how many tokens can be taken out of a pool if `tokenAmountIn` are sent, given the current balances.
    // The amplification parameter equals: A n^(n-1)
    // The invariant should be rounded up.
    function _calcOutGivenIn(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountIn,
        uint256 invariant
    ) internal pure returns (uint256) {
        /**************************************************************************************************************
        // outGivenIn token x for y - polynomial equation to solve                                                   //
        // ay = amount out to calculate                                                                              //
        // by = balance token out                                                                                    //
        // y = by - ay (finalBalanceOut)                                                                             //
        // D = invariant                                               D                     D^(n+1)                 //
        // A = amplification coefficient               y^2 + ( S - ----------  - D) * y -  ------------- = 0         //
        // n = number of tokens                                    (A * n^n)               A * n^2n * P              //
        // S = sum of final balances but y                                                                           //
        // P = product of final balances but y                                                                       //
        **************************************************************************************************************/

        // Amount out, so we round down overall.
        balances[tokenIndexIn] = balances[tokenIndexIn].add(tokenAmountIn);

        uint256 finalBalanceOut = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            balances,
            invariant,
            tokenIndexOut
        );

        // No need to use checked arithmetic since `tokenAmountIn` was actually added to the same balance right before
        // calling `_getTokenBalanceGivenInvariantAndAllOtherBalances` which doesn't alter the balances array.
        balances[tokenIndexIn] = balances[tokenIndexIn] - tokenAmountIn;

        return balances[tokenIndexOut].sub(finalBalanceOut).sub(1);
    }

    // Computes how many tokens must be sent to a pool if `tokenAmountOut` are sent given the
    // current balances, using the Newton-Raphson approximation.
    // The amplification parameter equals: A n^(n-1)
    // The invariant should be rounded up.
    function _calcInGivenOut(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountOut,
        uint256 invariant
    ) internal pure returns (uint256) {
        /**************************************************************************************************************
        // inGivenOut token x for y - polynomial equation to solve                                                   //
        // ax = amount in to calculate                                                                               //
        // bx = balance token in                                                                                     //
        // x = bx + ax (finalBalanceIn)                                                                              //
        // D = invariant                                                D                     D^(n+1)                //
        // A = amplification coefficient               x^2 + ( S - ----------  - D) * x -  ------------- = 0         //
        // n = number of tokens                                     (A * n^n)               A * n^2n * P             //
        // S = sum of final balances but x                                                                           //
        // P = product of final balances but x                                                                       //
        **************************************************************************************************************/

        // Amount in, so we round up overall.
        balances[tokenIndexOut] = balances[tokenIndexOut].sub(tokenAmountOut);

        uint256 finalBalanceIn = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            balances,
            invariant,
            tokenIndexIn
        );

        // No need to use checked arithmetic since `tokenAmountOut` was actually subtracted from the same balance right
        // before calling `_getTokenBalanceGivenInvariantAndAllOtherBalances` which doesn't alter the balances array.
        balances[tokenIndexOut] = balances[tokenIndexOut] + tokenAmountOut;

        return finalBalanceIn.sub(balances[tokenIndexIn]).add(1);
    }

    function _calcBptOutGivenExactTokensIn(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsIn,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // BPT out, so we round down overall.

        // First loop calculates the sum of all token balances, which will be used to calculate
        // the current weights of each token, relative to this sum
        uint256 sumBalances = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sumBalances = sumBalances.add(balances[i]);
        }

        // Calculate the weighted balance ratio without considering fees
        uint256[] memory balanceRatiosWithFee = new uint256[](amountsIn.length);
        // The weighted sum of token balance ratios with fee
        uint256 invariantRatioWithFees = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 currentWeight = balances[i].divDown(sumBalances);
            balanceRatiosWithFee[i] = balances[i].add(amountsIn[i]).divDown(balances[i]);
            invariantRatioWithFees = invariantRatioWithFees.add(balanceRatiosWithFee[i].mulDown(currentWeight));
        }

        // Second loop calculates new amounts in, taking into account the fee on the percentage excess
        uint256[] memory newBalances = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 amountInWithoutFee;

            // Check if the balance ratio is greater than the ideal ratio to charge fees or not
            if (balanceRatiosWithFee[i] > invariantRatioWithFees) {
                uint256 nonTaxableAmount = balances[i].mulDown(invariantRatioWithFees.sub(FixedPoint.ONE));
                uint256 taxableAmount = amountsIn[i].sub(nonTaxableAmount);
                // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
                amountInWithoutFee = nonTaxableAmount.add(taxableAmount.mulDown(FixedPoint.ONE - swapFeePercentage));
            } else {
                amountInWithoutFee = amountsIn[i];
            }

            newBalances[i] = balances[i].add(amountInWithoutFee);
        }

        // Get current and new invariants, taking swap fees into account
        uint256 currentInvariant = _calculateInvariant(amp, balances, true);
        uint256 newInvariant = _calculateInvariant(amp, newBalances, false);
        uint256 invariantRatio = newInvariant.divDown(currentInvariant);

        // If the invariant didn't increase for any reason, we simply don't mint BPT
        if (invariantRatio > FixedPoint.ONE) {
            return bptTotalSupply.mulDown(invariantRatio - FixedPoint.ONE);
        } else {
            return 0;
        }
    }

    function _calcTokenInGivenExactBptOut(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndex,
        uint256 bptAmountOut,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // Token in, so we round up overall.

        // Get the current invariant
        uint256 currentInvariant = _calculateInvariant(amp, balances, true);

        // Calculate new invariant
        uint256 newInvariant = bptTotalSupply.add(bptAmountOut).divUp(bptTotalSupply).mulUp(currentInvariant);

        // Calculate amount in without fee.
        uint256 newBalanceTokenIndex = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amp,
            balances,
            newInvariant,
            tokenIndex
        );
        uint256 amountInWithoutFee = newBalanceTokenIndex.sub(balances[tokenIndex]);

        // First calculate the sum of all token balances, which will be used to calculate
        // the current weight of each token
        uint256 sumBalances = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sumBalances = sumBalances.add(balances[i]);
        }

        // We can now compute how much extra balance is being deposited and used in virtual swaps, and charge swap fees
        // accordingly.
        uint256 currentWeight = balances[tokenIndex].divDown(sumBalances);
        uint256 taxablePercentage = currentWeight.complement();
        uint256 taxableAmount = amountInWithoutFee.mulUp(taxablePercentage);
        uint256 nonTaxableAmount = amountInWithoutFee.sub(taxableAmount);

        // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
        return nonTaxableAmount.add(taxableAmount.divUp(FixedPoint.ONE - swapFeePercentage));
    }

    /*
    Flow of calculations:
    amountsTokenOut -> amountsOutProportional ->
    amountOutPercentageExcess -> amountOutBeforeFee -> newInvariant -> amountBPTIn
    */
    function _calcBptInGivenExactTokensOut(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsOut,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // BPT in, so we round up overall.

        // First loop calculates the sum of all token balances, which will be used to calculate
        // the current weights of each token relative to this sum
        uint256 sumBalances = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sumBalances = sumBalances.add(balances[i]);
        }

        // Calculate the weighted balance ratio without considering fees
        uint256[] memory balanceRatiosWithoutFee = new uint256[](amountsOut.length);
        uint256 invariantRatioWithoutFees = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 currentWeight = balances[i].divUp(sumBalances);
            balanceRatiosWithoutFee[i] = balances[i].sub(amountsOut[i]).divUp(balances[i]);
            invariantRatioWithoutFees = invariantRatioWithoutFees.add(balanceRatiosWithoutFee[i].mulUp(currentWeight));
        }

        // Second loop calculates new amounts in, taking into account the fee on the percentage excess
        uint256[] memory newBalances = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it to
            // 'token out'. This results in slightly larger price impact.

            uint256 amountOutWithFee;
            if (invariantRatioWithoutFees > balanceRatiosWithoutFee[i]) {
                uint256 nonTaxableAmount = balances[i].mulDown(invariantRatioWithoutFees.complement());
                uint256 taxableAmount = amountsOut[i].sub(nonTaxableAmount);
                // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
                amountOutWithFee = nonTaxableAmount.add(taxableAmount.divUp(FixedPoint.ONE - swapFeePercentage));
            } else {
                amountOutWithFee = amountsOut[i];
            }

            newBalances[i] = balances[i].sub(amountOutWithFee);
        }

        // Get current and new invariants, taking into account swap fees
        uint256 currentInvariant = _calculateInvariant(amp, balances, true);
        uint256 newInvariant = _calculateInvariant(amp, newBalances, false);
        uint256 invariantRatio = newInvariant.divDown(currentInvariant);

        // return amountBPTIn
        return bptTotalSupply.mulUp(invariantRatio.complement());
    }

    function _calcTokenOutGivenExactBptIn(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndex,
        uint256 bptAmountIn,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // Token out, so we round down overall.

        // Get the current and new invariants. Since we need a bigger new invariant, we round the current one up.
        uint256 currentInvariant = _calculateInvariant(amp, balances, true);
        uint256 newInvariant = bptTotalSupply.sub(bptAmountIn).divUp(bptTotalSupply).mulUp(currentInvariant);

        // Calculate amount out without fee
        uint256 newBalanceTokenIndex = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amp,
            balances,
            newInvariant,
            tokenIndex
        );
        uint256 amountOutWithoutFee = balances[tokenIndex].sub(newBalanceTokenIndex);

        // First calculate the sum of all token balances, which will be used to calculate
        // the current weight of each token
        uint256 sumBalances = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sumBalances = sumBalances.add(balances[i]);
        }

        // We can now compute how much excess balance is being withdrawn as a result of the virtual swaps, which result
        // in swap fees.
        uint256 currentWeight = balances[tokenIndex].divDown(sumBalances);
        uint256 taxablePercentage = currentWeight.complement();

        // Swap fees are typically charged on 'token in', but there is no 'token in' here, so we apply it
        // to 'token out'. This results in slightly larger price impact. Fees are rounded up.
        uint256 taxableAmount = amountOutWithoutFee.mulUp(taxablePercentage);
        uint256 nonTaxableAmount = amountOutWithoutFee.sub(taxableAmount);

        // No need to use checked arithmetic for the swap fee, it is guaranteed to be lower than 50%
        return nonTaxableAmount.add(taxableAmount.mulDown(FixedPoint.ONE - swapFeePercentage));
    }

    function _calcTokensOutGivenExactBptIn(
        uint256[] memory balances,
        uint256 bptAmountIn,
        uint256 bptTotalSupply
    ) internal pure returns (uint256[] memory) {
        /**********************************************************************************************
        // exactBPTInForTokensOut                                                                    //
        // (per token)                                                                               //
        // aO = tokenAmountOut             /        bptIn         \                                  //
        // b = tokenBalance      a0 = b * | ---------------------  |                                 //
        // bptIn = bptAmountIn             \     bptTotalSupply    /                                 //
        // bpt = bptTotalSupply                                                                      //
        **********************************************************************************************/

        // Since we're computing an amount out, we round down overall. This means rounding down on both the
        // multiplication and division.

        uint256 bptRatio = bptAmountIn.divDown(bptTotalSupply);

        uint256[] memory amountsOut = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            amountsOut[i] = balances[i].mulDown(bptRatio);
        }

        return amountsOut;
    }

    // The amplification parameter equals: A n^(n-1)
    function _calcDueTokenProtocolSwapFeeAmount(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 lastInvariant,
        uint256 tokenIndex,
        uint256 protocolSwapFeePercentage
    ) internal pure returns (uint256) {
        /**************************************************************************************************************
        // oneTokenSwapFee - polynomial equation to solve                                                            //
        // af = fee amount to calculate in one token                                                                 //
        // bf = balance of fee token                                                                                 //
        // f = bf - af (finalBalanceFeeToken)                                                                        //
        // D = old invariant                                            D                     D^(n+1)                //
        // A = amplification coefficient               f^2 + ( S - ----------  - D) * f -  ------------- = 0         //
        // n = number of tokens                                    (A * n^n)               A * n^2n * P              //
        // S = sum of final balances but f                                                                           //
        // P = product of final balances but f                                                                       //
        **************************************************************************************************************/

        // Protocol swap fee amount, so we round down overall.

        uint256 finalBalanceFeeToken = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            balances,
            lastInvariant,
            tokenIndex
        );

        if (balances[tokenIndex] <= finalBalanceFeeToken) {
            // This shouldn't happen outside of rounding errors, but have this safeguard nonetheless to prevent the Pool
            // from entering a locked state in which joins and exits revert while computing accumulated swap fees.
            return 0;
        }

        // Result is rounded down
        uint256 accumulatedTokenSwapFees = balances[tokenIndex] - finalBalanceFeeToken;
        return accumulatedTokenSwapFees.mulDown(protocolSwapFeePercentage);
    }

    // This function calculates the balance of a given token (tokenIndex)
    // given all the other balances and the invariant
    function _getTokenBalanceGivenInvariantAndAllOtherBalances(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 invariant,
        uint256 tokenIndex
    ) internal pure returns (uint256) {
        // Rounds result up overall

        uint256 ampTimesTotal = amplificationParameter * balances.length;
        uint256 sum = balances[0];
        uint256 P_D = balances[0] * balances.length;
        for (uint256 j = 1; j < balances.length; j++) {
            P_D = Math.divDown(Math.mul(Math.mul(P_D, balances[j]), balances.length), invariant);
            sum = sum.add(balances[j]);
        }
        // No need to use safe math, based on the loop above `sum` is greater than or equal to `balances[tokenIndex]`
        sum = sum - balances[tokenIndex];

        uint256 inv2 = Math.mul(invariant, invariant);
        // We remove the balance from c by multiplying it
        uint256 c = Math.mul(
            Math.mul(Math.divUp(inv2, Math.mul(ampTimesTotal, P_D)), _AMP_PRECISION),
            balances[tokenIndex]
        );
        uint256 b = sum.add(Math.mul(Math.divDown(invariant, ampTimesTotal), _AMP_PRECISION));

        // We iterate to find the balance
        uint256 prevTokenBalance = 0;
        // We multiply the first iteration outside the loop with the invariant to set the value of the
        // initial approximation.
        uint256 tokenBalance = Math.divUp(inv2.add(c), invariant.add(b));

        for (uint256 i = 0; i < 255; i++) {
            prevTokenBalance = tokenBalance;

            tokenBalance = Math.divUp(
                Math.mul(tokenBalance, tokenBalance).add(c),
                Math.mul(tokenBalance, 2).add(b).sub(invariant)
            );

            if (tokenBalance > prevTokenBalance) {
                if (tokenBalance - prevTokenBalance <= 1) {
                    return tokenBalance;
                }
            } else if (prevTokenBalance - tokenBalance <= 1) {
                return tokenBalance;
            }
        }

        _revert(Errors.STABLE_GET_BALANCE_DIDNT_CONVERGE);
    }

    function _getRate(
        uint256[] memory balances,
        uint256 amp,
        uint256 supply
    ) internal pure returns (uint256) {
        // When calculating the current BPT rate, we may not have paid the protocol fees, therefore
        // the invariant should be smaller than its current value. Then, we round down overall.
        uint256 invariant = _calculateInvariant(amp, balances, false);
        return invariant.divDown(supply);
    }
}
