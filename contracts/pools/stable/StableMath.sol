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

import "../../lib/math/Math.sol";
import "../../lib/math/FixedPoint.sol";

// This is a contract to emulate file-level functions. Convert to a library
// after the migration to solc v0.7.1.

// solhint-disable private-vars-leading-underscore
// solhint-disable var-name-mixedcase

contract StableMath {
    using FixedPoint for uint256;

    uint256 internal constant _MIN_AMP = 1e18;
    uint256 internal constant _MAX_AMP = 5000 * (1e18);

    uint256 internal constant _MAX_STABLE_TOKENS = 5;

    // Computes the invariant given the current balances, using the Newton-Raphson approximation.
    // The amplification parameter equals: A n^(n-1)
    function _calculateInvariant(uint256 amplificationParameter, uint256[] memory balances)
        internal
        pure
        returns (uint256)
    {
        /**********************************************************************************************
        // invariant                                                                                 //
        // D = invariant                                                  D^(n+1)                    //
        // A = amplification coefficient      A  n^n S + D = A D n^n + -----------                   //
        // S = sum of balances                                             n^n P                     //
        // P = product of balances                                                                   //
        // n = number of tokens                                                                      //
        *********x************************************************************************************/

        // We round up the invariant.

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
        uint256 ampTimesTotal = Math.mul(amplificationParameter, numTokens);

        for (uint256 i = 0; i < 255; i++) {
            uint256 P_D = Math.mul(numTokens, balances[0]);
            for (uint256 j = 1; j < numTokens; j++) {
                P_D = Math.divUp(Math.mul(Math.mul(P_D, balances[j]), numTokens), invariant);
            }
            prevInvariant = invariant;
            invariant = Math.divUp(
                Math.mul(Math.mul(numTokens, invariant), invariant).add(Math.mul(Math.mul(ampTimesTotal, sum), P_D)),
                Math.mul(numTokens.add(1), invariant).add(Math.mul(ampTimesTotal.sub(1), P_D))
            );

            if (invariant > prevInvariant) {
                if (invariant.sub(prevInvariant) <= 1) {
                    break;
                }
            } else if (prevInvariant.sub(invariant) <= 1) {
                break;
            }
        }
        return invariant;
    }

    // Computes how many tokens can be taken out of a pool if `tokenAmountIn` are sent, given the current balances.
    // The amplification parameter equals: A n^(n-1)
    function _calcOutGivenIn(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountIn
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

        uint256 invariant = _calculateInvariant(amplificationParameter, balances);

        balances[tokenIndexIn] = balances[tokenIndexIn].add(tokenAmountIn);

        uint256 finalBalanceOut = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            balances,
            invariant,
            tokenIndexOut
        );

        balances[tokenIndexIn] = balances[tokenIndexIn].sub(tokenAmountIn);

        return balances[tokenIndexOut].sub(finalBalanceOut).sub(1);
    }

    // Computes how many tokens must be sent to a pool if `tokenAmountOut` are sent given the
    // current balances, using the Newton-Raphson approximation.
    // The amplification parameter equals: A n^(n-1)
    function _calcInGivenOut(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountOut
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

        uint256 invariant = _calculateInvariant(amplificationParameter, balances);

        balances[tokenIndexOut] = balances[tokenIndexOut].sub(tokenAmountOut);

        uint256 finalBalanceIn = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            balances,
            invariant,
            tokenIndexIn
        );

        balances[tokenIndexOut] = balances[tokenIndexOut].add(tokenAmountOut);

        return finalBalanceIn.sub(balances[tokenIndexIn]).add(1);
    }

    /*
    TODO: document it correctly
    Flow of calculations:
    amountsTokenIn -> amountsInProportional ->
    amountsInPercentageExcess -> amountsInAfterFee -> newInvariant -> amountBPTOut
    TODO: remove equations below and save them to Notion documentation
    amountInPercentageExcess = 1 - amountInProportional/amountIn (if amountIn>amountInProportional)
    amountInAfterFee = amountIn * (1 - swapFeePercentage * amountInPercentageExcess)
    amountInAfterFee = amountIn - fee amount
    fee amount = (amountIn - amountInProportional) * swapFeePercentage
    amountInAfterFee = amountIn - (amountIn - amountInProportional) * swapFeePercentage
    amountInAfterFee = amountIn * (1 - (1 - amountInProportional/amountIn) * swapFeePercentage)
    amountInAfterFee = amountIn * (1 - amountInPercentageExcess * swapFeePercentage)
    */
    function _calcBptOutGivenExactTokensIn(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsIn,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // BPT out, so we round down overall.

        // Get current invariant
        uint256 currentInvariant = _calculateInvariant(amp, balances);

        // First loop calculates the sum of all token balances, which will be used to calculate
        // the current weights of each token, relative to this sum
        uint256 sumBalances = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sumBalances = sumBalances.add(balances[i]);
        }

        // Calculate the weighted balance ratio without considering fees
        uint256[] memory tokenBalanceRatiosWithoutFee = new uint256[](amountsIn.length);
        // The weighted sum of token balance ratios without fee
        uint256 weightedBalanceRatio = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 currentWeight = balances[i].divDown(sumBalances);
            tokenBalanceRatiosWithoutFee[i] = balances[i].add(amountsIn[i]).divDown(balances[i]);
            weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosWithoutFee[i].mulDown(currentWeight));
        }

        // Second loop calculates new amounts in, taking into account the fee on the percentage excess
        uint256[] memory newBalances = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            // Percentage of the amount supplied that will be implicitly swapped for other tokens in the pool
            uint256 tokenBalancePercentageExcess;
            // Some tokens might have amounts supplied in excess of a 'balanced' join: these are identified if
            // the token's balance ratio without fee is larger than the weighted balance ratio, and swap fees are
            // charged on the swap amount
            if (weightedBalanceRatio >= tokenBalanceRatiosWithoutFee[i]) {
                tokenBalancePercentageExcess = 0;
            } else {
                tokenBalancePercentageExcess = tokenBalanceRatiosWithoutFee[i].sub(weightedBalanceRatio).divUp(
                    tokenBalanceRatiosWithoutFee[i].sub(FixedPoint.ONE)
                );
            }

            uint256 swapFeeExcess = swapFeePercentage.mulUp(tokenBalancePercentageExcess);

            uint256 amountInAfterFee = amountsIn[i].mulDown(swapFeeExcess.complement());

            newBalances[i] = balances[i].add(amountInAfterFee);
        }

        // get the new invariant, taking swap fees into account
        uint256 newInvariant = _calculateInvariant(amp, newBalances);

        // return amountBPTOut
        return bptTotalSupply.mulDown(newInvariant.divDown(currentInvariant).sub(FixedPoint.ONE));
    }

    /*
    TODO: document it correctly
    Flow of calculations:
    amountBPTOut -> newInvariant -> (amountInProportional, amountInAfterFee) ->
    amountInPercentageExcess -> amountIn
    */
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
        uint256 currentInvariant = _calculateInvariant(amp, balances);

        // Calculate new invariant
        uint256 newInvariant = bptTotalSupply.add(bptAmountOut).divUp(bptTotalSupply).mulUp(currentInvariant);

        // First calculate the sum of all token balances, which will be used to calculate
        // the current weight of each token
        uint256 sumBalances = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sumBalances = sumBalances.add(balances[i]);
        }

        // get amountInAfterFee
        uint256 newBalanceTokenIndex = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amp,
            balances,
            newInvariant,
            tokenIndex
        );
        uint256 amountInAfterFee = newBalanceTokenIndex.sub(balances[tokenIndex]);

        // Get tokenBalancePercentageExcess
        uint256 currentWeight = balances[tokenIndex].divDown(sumBalances);
        uint256 tokenBalancePercentageExcess = currentWeight.complement();

        uint256 swapFeeExcess = swapFeePercentage.mulUp(tokenBalancePercentageExcess);

        return amountInAfterFee.divUp(swapFeeExcess.complement());
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
        uint256 swapFee
    ) internal pure returns (uint256) {
        // BPT in, so we round up overall.

        // Get the current invariant
        uint256 currentInvariant = _calculateInvariant(amp, balances);

        // First loop calculates the sum of all token balances, which will be used to calculate
        // the current weights of each token relative to this sum
        uint256 sumBalances = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sumBalances = sumBalances.add(balances[i]);
        }

        // Calculate the weighted balance ratio without considering fees
        uint256[] memory tokenBalanceRatiosWithoutFee = new uint256[](amountsOut.length);
        uint256 weightedBalanceRatio = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 currentWeight = balances[i].divUp(sumBalances);
            tokenBalanceRatiosWithoutFee[i] = balances[i].sub(amountsOut[i]).divUp(balances[i]);
            weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosWithoutFee[i].mulUp(currentWeight));
        }

        // Second loop calculates new amounts in, taking into account the fee on the percentage excess
        uint256[] memory newBalances = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 tokenBalancePercentageExcess;
            // Compare each tokenBalanceRatioWithoutFee to the total weighted ratio (weightedBalanceRatio), and
            // decrease the fee by the excess amount
            if (weightedBalanceRatio <= tokenBalanceRatiosWithoutFee[i]) {
                tokenBalancePercentageExcess = 0;
            } else {
                tokenBalancePercentageExcess = weightedBalanceRatio.sub(tokenBalanceRatiosWithoutFee[i]).divUp(
                    tokenBalanceRatiosWithoutFee[i].complement()
                );
            }

            uint256 swapFeeExcess = swapFee.mulUp(tokenBalancePercentageExcess);

            uint256 amountOutBeforeFee = amountsOut[i].divUp(swapFeeExcess.complement());

            newBalances[i] = balances[i].sub(amountOutBeforeFee);
        }

        // get the new invariant, taking into account swap fees
        uint256 newInvariant = _calculateInvariant(amp, newBalances);

        // return amountBPTIn
        return bptTotalSupply.mulUp(newInvariant.divUp(currentInvariant).complement());
    }

    /*
    TODO: document it correctly
    Flow of calculations:
    amountBPTin -> newInvariant -> (amountOutProportional, amountOutBeforeFee) ->
    amountOutPercentageExcess -> amountOut
    */
    function _calcTokenOutGivenExactBptIn(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndex,
        uint256 bptAmountIn,
        uint256 bptTotalSupply,
        uint256 swapFeePercentage
    ) internal pure returns (uint256) {
        // Get the current invariant
        uint256 currentInvariant = _calculateInvariant(amp, balances);
        // Calculate the new invariant
        uint256 newInvariant = bptTotalSupply.sub(bptAmountIn).divUp(bptTotalSupply).mulUp(currentInvariant);

        // First calculate the sum of all token balances, which will be used to calculate
        // the current weight of each token
        uint256 sumBalances = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sumBalances = sumBalances.add(balances[i]);
        }

        // get amountOutBeforeFee
        uint256 newBalanceTokenIndex = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amp,
            balances,
            newInvariant,
            tokenIndex
        );
        uint256 amountOutBeforeFee = balances[tokenIndex].sub(newBalanceTokenIndex);

        // Calculate tokenBalancePercentageExcess
        uint256 currentWeight = balances[tokenIndex].divDown(sumBalances);
        uint256 tokenBalancePercentageExcess = currentWeight.complement();

        uint256 swapFeeExcess = swapFeePercentage.mulUp(tokenBalancePercentageExcess);

        return amountOutBeforeFee.mulDown(swapFeeExcess.complement());
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

        // Result is rounded down
        uint256 accumulatedTokenSwapFees = balances[tokenIndex] > finalBalanceFeeToken
            ? balances[tokenIndex].sub(finalBalanceFeeToken)
            : 0;
        return accumulatedTokenSwapFees.mulDown(protocolSwapFeePercentage).divDown(FixedPoint.ONE);
    }

    // Private functions

    // This function calculates the balance of a given token (tokenIndex)
    // given all the other balances and the invariant
    function _getTokenBalanceGivenInvariantAndAllOtherBalances(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 invariant,
        uint256 tokenIndex
    ) private pure returns (uint256) {
        // Rounds result up overall

        uint256 ampTimesTotal = Math.mul(amplificationParameter, balances.length);
        uint256 sum = balances[0];
        uint256 P_D = Math.mul(balances.length, balances[0]);
        for (uint256 j = 1; j < balances.length; j++) {
            P_D = Math.divDown(Math.mul(Math.mul(P_D, balances[j]), balances.length), invariant);
            sum = sum.add(balances[j]);
        }
        sum = sum.sub(balances[tokenIndex]);

        uint256 c = Math.divUp(Math.mul(invariant, invariant), ampTimesTotal);
        // We remove the balance fromm c by multiplying it
        c = c.mulUp(balances[tokenIndex]).divUp(P_D);

        uint256 b = sum.add(invariant.divDown(ampTimesTotal));

        // We iterate to find the balance
        uint256 prevTokenBalance = 0;
        // We multiply the first iteration outside the loop with the invariant to set the value of the
        // initial approximation.
        uint256 tokenBalance = invariant.mulUp(invariant).add(c).divUp(invariant.add(b));

        for (uint256 i = 0; i < 255; i++) {
            prevTokenBalance = tokenBalance;

            tokenBalance = tokenBalance.mulUp(tokenBalance).add(c).divUp(
                Math.mul(tokenBalance, 2).add(b).sub(invariant)
            );

            if (tokenBalance > prevTokenBalance) {
                if (tokenBalance.sub(prevTokenBalance) <= 1) {
                    break;
                }
            } else if (prevTokenBalance.sub(tokenBalance) <= 1) {
                break;
            }
        }
        return tokenBalance;
    }
}
