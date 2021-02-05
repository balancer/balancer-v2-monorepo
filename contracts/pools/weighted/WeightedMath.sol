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

pragma solidity ^0.7.1;

import "../../lib/math/Math.sol";
import "../../lib/math/FixedPoint.sol";
import "../../lib/math/LogExpMath.sol";

// This is a contract to emulate file-level functions. Convert to a library
// after the migration to solc v0.7.1.

/* solhint-disable private-vars-leading-underscore */

contract WeightedMath {
    using Math for uint256;
    using FixedPoint for uint256;

    // Computes how many tokens can be taken out of a pool if `tokenAmountIn` are sent, given the
    // current balances and weights.
    function _outGivenIn(
        uint256 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint256 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint256 tokenAmountIn
    ) internal pure returns (uint256) {
        /**********************************************************************************************
        // outGivenIn                                                                                //
        // aO = tokenAmountOut                                                                       //
        // bO = tokenBalanceOut                                                                      //
        // bI = tokenBalanceIn              /      /            bI             \    (wI / wO) \      //
        // aI = tokenAmountIn    aO = bO * |  1 - | --------------------------  | ^            |     //
        // wI = tokenWeightIn               \      \       ( bI + aI )         /              /      //
        // wO = tokenWeightOut                                                                       //
        **********************************************************************************************/

        uint256 quotient = tokenBalanceIn.div(tokenBalanceIn.add(tokenAmountIn));
        uint256 weightRatio = tokenWeightIn.div(tokenWeightOut);
        uint256 ratio = FixedPoint.ONE.sub(LogExpMath.pow(quotient, weightRatio));

        return tokenBalanceOut.mul(ratio);
    }

    // Computes how many tokens must be sent to a pool in order to take `tokenAmountOut`, given the
    // current balances and weights.
    function _inGivenOut(
        uint256 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint256 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint256 tokenAmountOut
    ) internal pure returns (uint256) {
        /**********************************************************************************************
        // inGivenOut                                                                                //
        // aO = tokenAmountOut                                                                       //
        // bO = tokenBalanceOut                                                                      //
        // bI = tokenBalanceIn              /  /            bO             \    (wO / wI)      \     //
        // aI = tokenAmountIn    aI = bI * |  | --------------------------  | ^            - 1  |    //
        // wI = tokenWeightIn               \  \       ( bO - aO )         /                   /     //
        // wO = tokenWeightOut                                                                       //
        **********************************************************************************************/

        uint256 quotient = tokenBalanceOut.div(tokenBalanceOut.sub(tokenAmountOut));
        uint256 weightRatio = tokenWeightOut.div(tokenWeightIn);
        uint256 ratio = LogExpMath.pow(quotient, weightRatio).sub(FixedPoint.ONE);

        return tokenBalanceIn.mul(ratio);
    }

    // Computes the invariant given the current balances and normalized weights.
    function _invariant(uint256[] memory normalizedWeights, uint256[] memory balances)
        internal
        pure
        returns (uint256 invariant)
    {
        /**********************************************************************************************
        // invariant               _____                                                             //
        // wi = weight index i      | |      wi                                                      //
        // bi = balance index i     | |  bi ^   = i                                                  //
        // i = invariant                                                                             //
        **********************************************************************************************/
        require(normalizedWeights.length == balances.length, "ARRAY_LENGTH_MISMATCH");

        invariant = FixedPoint.ONE;
        for (uint8 i = 0; i < normalizedWeights.length; i++) {
            invariant = invariant.mul(LogExpMath.pow(balances[i], normalizedWeights[i]));
        }
    }

    function _exactTokensInForBPTOut(
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory amountsIn,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        // First loop to calculate the weighted balance ratio
        // The increment `amountIn` represents for each token, as a quotient of new and current balances,
        // not accounting swap fees
        uint256[] memory tokenBalanceRatiosWithoutFee = new uint256[](amountsIn.length);
        // The weighted sum of token balance rations sans fee
        uint256 weightedBalanceRatio = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            tokenBalanceRatiosWithoutFee[i] = balances[i].add(amountsIn[i]).div(balances[i]);
            weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosWithoutFee[i].mul(normalizedWeights[i]));
        }

        //Second loop to calculate new amounts in taking into account the fee on the % excess
        // The growth of the invariant caused by the join, as a quotient of the new value and the current one
        uint256 invariantRatio = FixedPoint.ONE;
        for (uint256 i = 0; i < balances.length; i++) {
            // Percentage of the amount supplied that will be swapped for other tokens in the pool
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

            uint256 tokenBalanceRatio = FixedPoint.ONE.add((amountInAfterFee).div(balances[i]));

            invariantRatio = invariantRatio.mul(LogExpMath.pow(tokenBalanceRatio, normalizedWeights[i]));
        }

        return bptTotalSupply.mul(invariantRatio.sub(FixedPoint.ONE));
    }

    function _tokenInForExactBPTOut(
        uint256 tokenBalance,
        uint256 tokenNormalizedWeight,
        uint256 bptAmountOut,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        // Calculate the factor by which the invariant will increase after minting BPTAmountOut
        uint256 invariantRatio = bptTotalSupply.add(bptAmountOut).div(bptTotalSupply);

        // Calculate by how much the token balance has to increase to cause invariantRatio
        uint256 tokenBalanceRatio = LogExpMath.pow(invariantRatio, FixedPoint.ONE.div(tokenNormalizedWeight));
        uint256 tokenBalancePercentageExcess = FixedPoint.ONE.sub(tokenNormalizedWeight);
        uint256 amountInAfterFee = tokenBalance.mul(tokenBalanceRatio.sub(FixedPoint.ONE));

        return amountInAfterFee.div(FixedPoint.ONE.sub(tokenBalancePercentageExcess.mul(swapFee)));
    }

    function _exactBPTInForTokenOut(
        uint256 tokenBalance,
        uint256 tokenNormalizedWeight,
        uint256 bptAmountIn,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        // Calculate the factor by which the invariant will increase after minting BPTAmountOut
        uint256 invariantRatio = bptTotalSupply.sub(bptAmountIn).div(bptTotalSupply);

        //TODO: review impact of exp math error that increases result
        // Calculate by how much the token balance has to increase to cause invariantRatio
        uint256 tokenBalanceRatio = LogExpMath.pow(invariantRatio, FixedPoint.ONE.div(tokenNormalizedWeight));
        uint256 tokenBalancePercentageExcess = FixedPoint.ONE.sub(tokenNormalizedWeight);
        uint256 amountOutBeforeFee = tokenBalance.mul(FixedPoint.ONE.sub(tokenBalanceRatio));

        return amountOutBeforeFee.mul(FixedPoint.ONE.sub(tokenBalancePercentageExcess.mul(swapFee)));
    }

    function exactBPTInForAllTokensOut(
        uint256[] memory currentBalances,
        uint256 bptAmountIn,
        uint256 totalBPT
    ) internal pure returns (uint256[] memory array) {
        /**********************************************************************************************
        // exactBPTInForAllTokensOut                                                                 //
        // (per token)                                                                               //
        // aO = tokenAmountOut             /        bptIn         \                                  //
        // b = tokenBalance      a0 = b * | ---------------------  |                                 //
        // bptIn = bptAmountIn             \       totalBPT       /                                  //
        // bpt = totalBPT                                                                            //
        **********************************************************************************************/

        // Since we're computing an amount out, we round down overall. This means rouding down on both the
        // multiplication and division.

        uint256 bptRatio = bptAmountIn.divDown(totalBPT);

        uint256[] memory amountsOut = new uint256[](currentBalances.length);
        for (uint256 i = 0; i < currentBalances.length; i++) {
            amountsOut[i] = currentBalances[i].mulDown(bptRatio);
        }
    }

    function _bptInForExactTokensOut(
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory amountsOut,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        // First loop to calculate the weighted balance ratio
        uint256[] memory tokenBalanceRatiosWithoutFee = new uint256[](amountsOut.length);
        uint256 weightedBalanceRatio = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            tokenBalanceRatiosWithoutFee[i] = balances[i].sub(amountsOut[i]).div(balances[i]);
            weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosWithoutFee[i].mul(normalizedWeights[i]));
        }

        //Second loop to calculate new amounts in taking into account the fee on the % excess
        uint256 invariantRatio = FixedPoint.ONE;
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

            tokenBalanceRatio = FixedPoint.ONE.sub((amountOutBeforeFee).div(balances[i]));

            invariantRatio = invariantRatio.mul(LogExpMath.pow(tokenBalanceRatio, normalizedWeights[i]));
        }

        return bptTotalSupply.mul(FixedPoint.ONE.sub(invariantRatio));
    }

    function _calculateDueTokenProtocolSwapFee(
        uint256 balance,
        uint256 normalizedWeight,
        uint256 previousInvariant,
        uint256 currentInvariant,
        uint256 protocolSwapFeePercentage
    ) internal pure returns (uint256) {
        /*********************************************************************************
        /*  protocolSwapFee * balanceToken * ( 1 - (previousInvariant / currentInvariant) ^ (1 / weightToken))
        *********************************************************************************/

        // We're computing due protocol swap fees, so overall we round up. Fee percentage and balance multiplications
        // round up, while the subtrahend (power) rounds down (as does the base). Because
        // previousInvariant / currentInvariant <= 1, the exponent rounds up.

        if (currentInvariant < previousInvariant) {
            // This should never happen, but this acts as a safeguard to prevent the Pool from entering a locked state
            // in which joins and exits revert while computing accumulated swap fees.
            return 0;
        }

        uint256 base = previousInvariant.divDown(currentInvariant);
        uint256 exponent = FixedPoint.ONE.divUp(normalizedWeight);

        uint256 power = LogExpMath.powUp(base, exponent);

        uint256 tokenAccruedFees = balance.mulUp(FixedPoint.ONE.sub(power));
        return tokenAccruedFees.mulUp(protocolSwapFeePercentage);
    }
}
