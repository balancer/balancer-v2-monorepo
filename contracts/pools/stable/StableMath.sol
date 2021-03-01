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

    /**********************************************************************************************
    // invariant                                                                                 //
    // D = invariant to compute                                                                  //
    // A = amplifier                n * D^2 + A * n^n * S * (n^n * P / D^(n−1))                  //
    // S = sum of balances         ____________________________________________                  //
    // P = product of balances    (n+1) * D + ( A * n^n − 1)* (n^n * P / D^(n−1))                //
    // n = number of tokens                                                                      //
    **********************************************************************************************/
    function _invariant(uint256 amp, uint256[] memory balances) internal pure returns (uint256) {
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        for (uint256 i = 0; i < totalCoins; i++) {
            sum = sum.add(balances[i]);
        }
        if (sum == 0) {
            return 0;
        }
        uint256 prevInv = 0;
        uint256 inv = sum;
        uint256 ampTimesTotal = amp.mul(totalCoins);

        for (uint256 i = 0; i < 255; i++) {
            uint256 P_D = totalCoins.mul(balances[0]);
            for (uint256 j = 1; j < totalCoins; j++) {
                //P_D is rounded up
                P_D = P_D.mul(balances[j]).mul(totalCoins).divUp(inv);
            }
            prevInv = inv;
            //inv is rounded up
            inv = totalCoins.mul(inv).mul(inv).add(ampTimesTotal.mul(sum).mul(P_D)).divUp(
                totalCoins.add(1).mul(inv).add((ampTimesTotal.sub(1).mul(P_D)))
            );
            // Equality with the precision of 1
            if (inv > prevInv) {
                if ((inv.sub(prevInv)) <= 1) {
                    break;
                }
            } else if ((prevInv.sub(inv)) <= 1) {
                break;
            }
        }
        //Result is rounded up
        return inv;
    }

    /**********************************************************************************************
    // inGivenOut token x for y - polynomial equation to solve                                   //
    // ax = amount in to calculate                                                               //
    // bx = balance token in                                                                     //
    // x = bx + ax                                                                               //
    // D = invariant                               D                     D^(n+1)                 //
    // A = amplifier               x^2 + ( S - ----------  - 1) * x -  ------------- = 0         //
    // n = number of tokens                    (A * n^n)               A * n^2n * P              //
    // S = sum of final balances but x                                                           //
    // P = product of final balances but x                                                       //
    **********************************************************************************************/
    function _inGivenOut(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountOut
    ) internal pure returns (uint256) {
        //Invariant is rounded up
        uint256 inv = _invariant(amp, balances);
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 nPowN = 1;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            nPowN = nPowN.mul(totalCoins);
            if (i == tokenIndexOut) {
                x = balances[i].sub(tokenAmountOut);
            } else if (i != tokenIndexIn) {
                x = balances[i];
            } else {
                continue;
            }
            sum = sum.add(x);
            //Round up p
            p = p.mul(inv).divUp(x);
        }

        //Calculate in balance
        uint256 y = _solveAnalyticalBalance(sum, inv, amp, nPowN, p);

        //Result is rounded up
        return y.sub(balances[tokenIndexIn]);
    }

    /**********************************************************************************************
    // outGivenIn token x for y - polynomial equation to solve                                   //
    // ay = amount out to calculate                                                              //
    // by = balance token out                                                                    //
    // y = by - ay                                                                               //
    // D = invariant                               D                     D^(n+1)                 //
    // A = amplifier               y^2 + ( S - ----------  - 1) * y -  ------------- = 0         //
    // n = number of tokens                    (A * n^n)               A * n^2n * P              //
    // S = sum of final balances but y                                                           //
    // P = product of final balances but y                                                       //
    **********************************************************************************************/
    function _outGivenIn(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountIn
    ) internal pure returns (uint256) {
        //Invariant is rounded up
        uint256 inv = _invariant(amp, balances);
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 nPowN = 1;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            nPowN = nPowN.mul(totalCoins);
            if (i == tokenIndexIn) {
                x = balances[i].add(tokenAmountIn);
            } else if (i != tokenIndexOut) {
                x = balances[i];
            } else {
                continue;
            }
            sum = sum.add(x);
            //Round up p
            p = p.mul(inv).divUp(x);
        }

        //Calculate out balance
        uint256 y = _solveAnalyticalBalance(sum, inv, amp, nPowN, p);

        //Result is rounded down
        return balances[tokenIndexOut] > y ? balances[tokenIndexOut].sub(y) : 0;
    }

    function _tokensInForExactBPTOut(
        uint256[] memory balances,
        uint256 bptAmountOut,
        uint256 bptTotalSupply
    ) internal pure returns (uint256[] memory) {
        /**********************************************************************************************
        // tokensInForExactBPTOut                                                                 //
        // (per token)                                                                               //
        // aI = tokenAmountIn              /        bptOut         \                                 //
        // b = tokenBalance      aI = b * | ---------------------  |                                 //
        // bptOut = bptAmountOut           \       bptTotalSupply       /                                  //
        // bpt = bptTotalSupply                                                                            //
        **********************************************************************************************/

        // Since we're computing an amount in, we round up overall. This means rouding up on both the multiplication and
        // division.

        uint256[] memory amountsIn = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            amountsIn[i] = balances[i].mul(bptAmountOut).divUp(bptTotalSupply);
        }

        return amountsIn;
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
            tokenBalanceRatiosWithoutFee[i] = balances[i].add(amountsIn[i]).div(balances[i]);
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
                tokenBalancePercentageExcess = tokenBalanceRatiosWithoutFee[i].sub(weightedBalanceRatio).div(
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
        uint256 newInvariant = bptTotalSupply.add(bptAmountOut).divUp(bptTotalSupply);

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
            tokenIndex);
        uint256 amountInAfterFee = newBalanceTokenIndex.sub(balances[tokenIndex]);

        // Get tokenBalancePercentageExcess
        uint256 currentWeight = balances[tokenIndex].divDown(sumBalances);
        uint256 tokenBalancePercentageExcess = FixedPoint.ONE.sub(currentWeight);

        // return amountIn
        return amountInAfterFee.div(FixedPoint.ONE.sub(tokenBalancePercentageExcess.mul(swapFee)));
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
            tokenBalanceRatiosWithoutFee[i] = balances[i].sub(amountsOut[i]).div(balances[i]);
            weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosWithoutFee[i].mul(currentWeight));
        }

        // Second loop to calculate new amounts in taking into account the fee on the % excess
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 tokenBalancePercentageExcess;
            uint256 tokenBalanceRatio;
            // For each ratioSansFee, compare with the total weighted ratio (weightedBalanceRatio) and
            // decrease the fee from what goes above it
            if (weightedBalanceRatio <= tokenBalanceRatiosWithoutFee[i]) {
                tokenBalancePercentageExcess = 0;
            } else {
                tokenBalancePercentageExcess = weightedBalanceRatio.sub(tokenBalanceRatiosWithoutFee[i]).div(
                    FixedPoint.ONE.sub(tokenBalanceRatiosWithoutFee[i])
                );
            }
            uint256 amountOutBeforeFee = amountsOut[i].div(
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
        uint256 newInvariant = bptTotalSupply.sub(bptAmountIn).divUp(bptTotalSupply);

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
            tokenIndex);
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

    /**********************************************************************************************
    // oneTokenSwapFee - polynomial equation to solve                                            //
    // af = fee amount to calculate in one token                                                 //
    // bf = balance of token                                                                     //
    // f = bf - af                                                                               //
    // D = old invariant                            D                     D^(n+1)                //
    // A = amplifier               f^2 + ( S - ----------  - 1) * f -  ------------- = 0         //
    // n = number of tokens                    (A * n^n)               A * n^2n * P              //
    // S = sum of final balances but f                                                           //
    // P = product of final balances but f                                                       //
    **********************************************************************************************/
    function _calculateDueTokenProtocolSwapFee(
        uint256 amp,
        uint256[] memory balances,
        uint256 lastInvariant,
        uint256 tokenIndex,
        uint256 protocolSwapFeePercentage
    ) internal pure returns (uint256) {
        // We round down to prevent issues in the Pool's accounting, even if it means paying slightly less protocol fees
        // to the Vault.

        //Last invariant is rounded up
        uint256 inv = lastInvariant;
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 nPowN = 1;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            nPowN = nPowN.mul(totalCoins);
            if (i != tokenIndex) {
                x = balances[i];
            } else {
                continue;
            }
            sum = sum.add(x);
            //Round up p
            p = p.mul(inv).divUp(x);
        }

        //Calculate token balance
        uint256 y = _solveAnalyticalBalance(sum, inv, amp, nPowN, p);

        //Result is rounded down
        uint256 accumulatedTokenSwapFees = balances[tokenIndex] > y ? balances[tokenIndex].sub(y) : 0;
        return accumulatedTokenSwapFees.mul(protocolSwapFeePercentage).divUp(FixedPoint.ONE);
    }

    //Private functions

    //This function calculates the balance of a given token (tokenIndex) 
    // given all the other balances and the invariant
    function _getTokenBalanceGivenInvariantAndAllOtherBalances(
        uint256 amp,
        uint256[] memory balances,
        uint256 inv,
        uint256 tokenIndex
    ) private pure returns (uint256 tokenBalance) {
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 nPowN = 1;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            nPowN = nPowN.mul(totalCoins);
            if (i != tokenIndex) {
                x = balances[i];
            } else {
                continue;
            }
            sum = sum.add(x);
            //Round up p
            p = p.mul(inv).divUp(x);
        }

        // Calculate token balance
        return _solveAnalyticalBalance(sum, inv, amp, nPowN, p);
    }

    //This function calcuates the analytical solution to find the balance required
    function _solveAnalyticalBalance(
        uint256 sum,
        uint256 inv,
        uint256 amp,
        uint256 nPowN,
        uint256 p
    ) private pure returns (uint256 y) {
        //Round up p
        p = p.mul(inv).divUp(amp.mul(nPowN).mul(nPowN));
        //Round down b
        uint256 b = sum.add(inv.divDown(amp.mul(nPowN)));
        //Round up c
        uint256 c = inv >= b
            ? inv.sub(b).add(Math.sqrtUp(inv.sub(b).mul(inv.sub(b)).add(p.mul(4))))
            : Math.sqrtUp(b.sub(inv).mul(b.sub(inv)).add(p.mul(4))).sub(b.sub(inv));
        //Round up y
        y = c == 0 ? 0 : c.divUp(2);
    }
}
