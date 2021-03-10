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
    using Math for uint256;

    // Computes how many tokens can be taken out of a pool if `tokenAmountIn` are sent, given the
    // current balances.
    // The amplification parameter equals to: A n^(n-1)
    function _outGivenIn(
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

        uint256 invariant = _invariant(amplificationParameter, balances);

        balances[tokenIndexIn] = balances[tokenIndexIn].add(tokenAmountIn);

        uint256 finalBalanceOut = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            balances,
            invariant,
            tokenIndexOut
        );

        //TODO: revert balance changes?
        balances[tokenIndexIn] = balances[tokenIndexIn].sub(tokenAmountIn);

        return balances[tokenIndexOut].sub(finalBalanceOut).sub(1);
    }

    // Computes how many tokens must be sent to a pool if `tokenAmountOut` are sent given the
    // current balances using Newton-Raphson approximation.
    // The amplification parameter equals to: A n^(n-1)
    function _inGivenOut(
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

        uint256 invariant = _invariant(amplificationParameter, balances);

        balances[tokenIndexOut] = balances[tokenIndexOut].sub(tokenAmountOut);

        uint256 finalBalanceIn = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            balances,
            invariant,
            tokenIndexIn
        );

        //TODO: revert balance changes?
        balances[tokenIndexOut] = balances[tokenIndexOut].add(tokenAmountOut);

        return finalBalanceIn.sub(balances[tokenIndexIn]).add(1);
    }

    // Computes the invariant given the current balances using Newton-Raphson approximation.
    // The amplification parameter equals to: A n^(n-1)
    function _invariant(uint256 amplificationParameter, uint256[] memory balances) internal pure returns (uint256) {
        /**********************************************************************************************
        // invariant                                                                                 //
        // D = invariant                                                  D^(n+1)                    //
        // A = amplification coefficient      A  n^n S + D = A D n^n + -----------                   //
        // S = sum of balances                                             n^n P                     //
        // P = product of balances                                                                   //
        // n = number of tokens                                                                      //
        *********x************************************************************************************/

        // We round up invariant.

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
        uint256 ampTimesTotal = amplificationParameter.mul(numTokens);

        for (uint256 i = 0; i < 255; i++) {
            uint256 P_D = numTokens.mul(balances[0]);
            for (uint256 j = 1; j < numTokens; j++) {
                P_D = P_D.mul(balances[j]).mul(numTokens).divUp(invariant);
            }
            prevInvariant = invariant;
            invariant = numTokens.mul(invariant).mul(invariant).add(ampTimesTotal.mul(sum).mul(P_D)).divUp(
                numTokens.add(1).mul(invariant).add((ampTimesTotal.sub(1).mul(P_D)))
            );

            if (prevInvariant <= invariant.add(1)) {
                break;
            }
        }
        return invariant;
    }

    function _allTokensInForExactBPTOut(
        uint256[] memory balances,
        uint256 bptAmountOut,
        uint256 bptTotalSupply
    ) internal pure returns (uint256[] memory) {
        /**********************************************************************************************
        // allTokensInForExactBPTOut                                                                 //
        // (per token)                                                                               //
        // aI = tokenAmountIn              /        bptOut         \                                 //
        // b = tokenBalance      aI = b * | ---------------------  |                                 //
        // bptOut = bptAmountOut           \       bptTotalSupply       /                            //
        // bpt = bptTotalSupply                                                                      //
        **********************************************************************************************/

        // Since we're computing an amount in, we round up overall. This means rouding up on both the multiplication and
        // division.

        uint256[] memory amountsOut = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            amountsOut[i] = balances[i].mul(bptAmountOut).divUp(bptTotalSupply);
        }

        return amountsOut;
    }

    function _exactBPTInForAllTokensOut(
        uint256[] memory balances,
        uint256 bptAmountIn,
        uint256 bptTotalSupply
    ) internal pure returns (uint256[] memory) {
        /**********************************************************************************************
        // exactBPTInForAllTokensOut                                                                 //
        // (per token)                                                                               //
        // aO = tokenAmountOut             /        bptIn         \                                  //
        // b = tokenBalance      a0 = b * | ---------------------  |                                 //
        // bptIn = bptAmountIn             \       bptTotalSupply       /                            //
        // bpt = bptTotalSupply                                                                      //
        **********************************************************************************************/

        // Since we're computing an amount out, we round down overall. This means rouding down on both the
        // multiplication and division.

        uint256[] memory amountsOut = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            amountsOut[i] = balances[i].mul(bptAmountIn).divDown(bptTotalSupply);
        }

        return amountsOut;
    }

    /* 
    Flow of calculations:
    amountsTokenIn -> amountsInProportional ->
    amountsInPercentageExcess -> amountsInAfterFee -> newInvariant -> amountBPTOut
    TODO: remove equations below and save them to Notion documentation 
    amountInPercentageExcess = 1 - amountInProportional/amountIn (if amountIn>amountInProportional)
    amountInAfterFee = amountIn * (1 - swapFee * amountInPercentageExcess)
    amountInAfterFee = amountIn - fees 
    fees = (amountIn - amountInProportional) * swapFee
    amountInAfterFee = amountIn - (amountIn - amountInProportional) * swapFee
    amountInAfterFee = amountIn * (1 - (1 - amountInProportional/amountIn) * swapFee)
    amountInAfterFee = amountIn * (1 - amountInPercentageExcess * swapFee)
    */
    function _exactTokensInForBPTOut(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsIn,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        // Get current invariant
        uint256 currentInvariant = _invariant(amp, balances);

        // First calculate the sum of all token balances which will be used to calculate
        // the current weights of each token relative to the sum of all balances
        uint256 sumBalances = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sumBalances = sumBalances.add(balances[i]);
        }

        // Calculate the weighted balance ratio without considering fees
        uint256[] memory tokenBalanceRatiosWithoutFee = new uint256[](amountsIn.length);
        uint256 weightedBalanceRatio = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 currentWeight = balances[i].divDown(sumBalances);
            tokenBalanceRatiosWithoutFee[i] = balances[i].add(amountsIn[i]).divDown(balances[i]);
            weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosWithoutFee[i].mul(currentWeight));
        }

        // Second loop to calculate new amounts in taking into account the fee on the % excess
        for (uint256 i = 0; i < balances.length; i++) {
            // Percentage of the amount supplied that will be implicitly swapped for other tokens in the pool
            uint256 tokenBalancePercentageExcess;
            // Some tokens might have amounts supplied in excess of a 'balanced' join: these are identified if
            // the token's balance ratio sans fee is larger than the weighted balance ratio, and swap fees charged
            // on the amount to swap
            if (weightedBalanceRatio >= tokenBalanceRatiosWithoutFee[i]) {
                tokenBalancePercentageExcess = 0;
            } else {
                tokenBalancePercentageExcess = tokenBalanceRatiosWithoutFee[i].sub(weightedBalanceRatio).divUp(
                    tokenBalanceRatiosWithoutFee[i].sub(FixedPoint.ONE)
                );
            }

            uint256 amountInAfterFee = amountsIn[i].mul(FixedPoint.ONE.sub(swapFee.mul(tokenBalancePercentageExcess)));
            balances[i] = balances[i].add(amountInAfterFee);
        }

        // get new invariant taking into account swap fees
        uint256 newInvariant = _invariant(amp, balances);

        // return amountBPTOut
        return bptTotalSupply.mul(newInvariant.divDown(currentInvariant).sub(FixedPoint.ONE));
    }

    /* 
    Flow of calculations:
    amountBPTOut -> newInvariant -> (amountInProportional, amountInAfterFee) ->
    amountInPercentageExcess -> amountIn
    */
    function _tokenInForExactBPTOut(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndex,
        uint256 bptAmountOut,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        /**********************************************************************************************
        // TODO description                            //
        **********************************************************************************************/

        // Get current invariant
        uint256 currentInvariant = _invariant(amp, balances);

        // Calculate new invariant
        uint256 newInvariant = bptTotalSupply.add(bptAmountOut).divUp(bptTotalSupply).mul(currentInvariant);

        // First calculate the sum of all token balances which will be used to calculate
        // the current weight of token
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
        uint256 tokenBalancePercentageExcess = FixedPoint.ONE.sub(currentWeight);

        // return amountIn
        return amountInAfterFee.divUp(FixedPoint.ONE.sub(tokenBalancePercentageExcess.mul(swapFee)));
    }

    /* 
    Flow of calculations:
    amountsTokenOut -> amountsOutProportional ->
    amountOutPercentageExcess -> amountOutBeforeFee -> newInvariant -> amountBPTIn
    */
    function _BPTInForExactTokensOut(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsOut,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        // Get current invariant
        uint256 currentInvariant = _invariant(amp, balances);

        // First calculate the sum of all token balances which will be used to calculate
        // the current weights of each token relative to the sum of all balances
        uint256 sumBalances = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            sumBalances = sumBalances.add(balances[i]);
        }

        // Calculate the weighted balance ratio without considering fees
        uint256[] memory tokenBalanceRatiosWithoutFee = new uint256[](amountsOut.length);
        uint256 weightedBalanceRatio = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 currentWeight = balances[i].divDown(sumBalances);
            tokenBalanceRatiosWithoutFee[i] = balances[i].sub(amountsOut[i]).divUp(balances[i]);
            weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosWithoutFee[i].mul(currentWeight));
        }

        // Second loop to calculate new amounts in taking into account the fee on the % excess
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 tokenBalancePercentageExcess;
            // For each ratioSansFee, compare with the total weighted ratio (weightedBalanceRatio) and
            // decrease the fee from what goes above it
            if (weightedBalanceRatio <= tokenBalanceRatiosWithoutFee[i]) {
                tokenBalancePercentageExcess = 0;
            } else {
                tokenBalancePercentageExcess = weightedBalanceRatio.sub(tokenBalanceRatiosWithoutFee[i]).divUp(
                    FixedPoint.ONE.sub(tokenBalanceRatiosWithoutFee[i])
                );
            }
            uint256 amountOutBeforeFee = amountsOut[i].divUp(
                FixedPoint.ONE.sub(swapFee.mul(tokenBalancePercentageExcess))
            );
            balances[i] = balances[i].sub(amountOutBeforeFee);
        }

        // get new invariant taking into account swap fees
        uint256 newInvariant = _invariant(amp, balances);

        // return amountBPTIn
        return bptTotalSupply.mul(FixedPoint.ONE.sub(newInvariant.divUp(currentInvariant)));
    }

    /* 
    Flow of calculations:
    amountBPTin -> newInvariant -> (amountOutProportional, amountOutBeforeFee) ->
    amountOutPercentageExcess -> amountOut
    */
    function _exactBPTInForTokenOut(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndex,
        uint256 bptAmountIn,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        /**********************************************************************************************
        // TODO description                            //
        **********************************************************************************************/

        // Get current invariant
        uint256 currentInvariant = _invariant(amp, balances);
        // Calculate new invariant
        uint256 newInvariant = bptTotalSupply.sub(bptAmountIn).divUp(bptTotalSupply).mul(currentInvariant);

        // First calculate the sum of all token balances which will be used to calculate
        // the current weight of token
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
        uint256 tokenBalancePercentageExcess = FixedPoint.ONE.sub(currentWeight);

        // return amountOut
        return amountOutBeforeFee.mul(FixedPoint.ONE.sub(tokenBalancePercentageExcess.mul(swapFee)));
    }

    function _exactBPTInForTokensOut(
        uint256[] memory balances,
        uint256 bptAmountIn,
        uint256 bptTotalSupply
    ) internal pure returns (uint256[] memory) {
        /**********************************************************************************************
        // exactBPTInForTokensOut                                                                 //
        // (per token)                                                                               //
        // aO = tokenAmountOut             /        bptIn         \                                  //
        // b = tokenBalance      a0 = b * | ---------------------  |                                 //
        // bptIn = bptAmountIn             \       bptTotalSupply       /                                  //
        // bpt = bptTotalSupply                                                                            //
        **********************************************************************************************/

        // Since we're computing an amount out, we round down overall. This means rouding down on both the
        // multiplication and division.

        uint256[] memory amountsOut = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            amountsOut[i] = balances[i].mul(bptAmountIn).divDown(bptTotalSupply);
        }

        return amountsOut;
    }

    // The amplification parameter equals to: A n^(n-1)
    function _calculateDueTokenProtocolSwapFee(
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

        // Protocol swap fee, so we round down overall.

        uint256 finalBalanceFeeToken = _getTokenBalanceGivenInvariantAndAllOtherBalances(
            amplificationParameter,
            balances,
            lastInvariant,
            tokenIndex
        );

        //Result is rounded down
        uint256 accumulatedTokenSwapFees = balances[tokenIndex] > finalBalanceFeeToken
            ? balances[tokenIndex].sub(finalBalanceFeeToken)
            : 0;
        return accumulatedTokenSwapFees.mul(protocolSwapFeePercentage).divDown(FixedPoint.ONE);
    }

    //Private functions

    //This function calculates the balance of a given token (tokenIndex)
    // given all the other balances and the invariant
    function _getTokenBalanceGivenInvariantAndAllOtherBalances(
        uint256 amplificationParameter,
        uint256[] memory balances,
        uint256 invariant,
        uint256 tokenIndex
    ) private pure returns (uint256 tokenBalance) {
        //Rounds result up overall

        uint256 ampTimesTotal = amplificationParameter.mul(balances.length);
        uint256 sum = balances[0];
        uint256 P_D = balances.length.mul(balances[0]);
        for (uint256 j = 1; j < balances.length; j++) {
            P_D = P_D.mul(balances[j]).mul(balances.length).divDown(invariant);
            sum = sum.add(balances[j]);
        }
        sum = sum.sub(balances[tokenIndex]);
        uint256 c = invariant.mul(invariant).divUp(ampTimesTotal.mul(P_D));
        c = c.mul(balances[tokenIndex]);
        uint256 b = sum.add(invariant.divDown(ampTimesTotal));
        uint256 x_prev = 0;
        uint256 x = invariant.mul(invariant).add(c).divUp(invariant.add(b));
        for (uint256 i = 0; i < 255; i++) {
            x_prev = x;
            x = x.mul(x).add(c).divUp(x.mul(2).add(b).sub(invariant));
            if (x_prev <= x.add(1)) break;
        }
        return x;
    }
}
