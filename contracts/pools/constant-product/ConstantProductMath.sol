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

import "@openzeppelin/contracts/utils/SafeCast.sol";

import "hardhat/console.sol";

import "../../math/FixedPoint.sol";
import "../../math/LogExpMath.sol";

// This is a contract to emulate file-level functions. Convert to a library
// after the migration to solc v0.7.1.

/* solhint-disable private-vars-leading-underscore */

contract ConstantProductMath {
    using SafeCast for uint256;
    using SafeCast for int256;
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    // Computes how many tokens can be taken out of a pool if `tokenAmountIn` are sent, given the
    // current balances and weights.
    function _outGivenIn(
        uint128 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint128 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint128 tokenAmountIn
    ) internal pure returns (uint128) {
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
        uint256 ratio = FixedPoint.ONE.sub(
            LogExpMath.exp(int256(quotient), int256(weightRatio)).toUint256().toUint128()
        );

        return tokenBalanceOut.mul(ratio).toUint128();
    }

    // Computes how many tokens must be sent to a pool in order to take `tokenAmountOut`, given the
    // current balances and weights.
    function _inGivenOut(
        uint128 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint128 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint128 tokenAmountOut
    ) internal pure returns (uint128) {
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
        uint256 ratio = LogExpMath.exp(int256(quotient), int256(weightRatio)).toUint256().toUint128().sub(
            FixedPoint.ONE
        );

        return tokenBalanceIn.mul(ratio).toUint128();
    }

    // Computes the invariant given the current balances and normalized weights.
    function _invariant(uint256[] memory normalizedWeights, uint128[] memory balances)
        internal
        pure
        returns (uint256 invariant)
    {
        require(normalizedWeights.length == balances.length, "ERR_BALANCES_LENGTH");

        invariant = FixedPoint.ONE;
        for (uint8 i = 0; i < normalizedWeights.length; i++) {
            invariant = invariant.mul(LogExpMath.exp(int256(balances[i]), int256(normalizedWeights[i])).toUint256());
        }
    }

    function _exactTokensInForBPTOut(
        uint128[] memory balances,
        uint256[] memory normalizedWeights,
        uint128[] memory amountsIn,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        // First loop to calculate the weighted balance ratio
        // The increment `amountIn` represents for each token, as a quotient of new and current balances, not accounting swap fees
        uint256[] memory tokenBalanceRatiosBeforeFee = new uint256[](amountsIn.length);
        // The weighted sum of token balance rations sans fee
        uint256 weightedBalanceRatio = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            tokenBalanceRatiosBeforeFee[i] = balances[i].add(amountsIn[i]).div(balances[i]); //128
            weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosBeforeFee[i].mul(normalizedWeights[i]));
        }

        //Second loop to calculate new amounts in taking into account the fee on the % excess
        uint256 invariantRatio = FixedPoint.ONE;
        for (uint256 i = 0; i < balances.length; i++) {
            // Percentage of the amount supplied that will be swapped for other tokens in the pool
            uint256 tokenBalancePercentageExcess;
            uint256 tokenBalanceRatio;
            // Some tokens might have amounts supplied in excess of a 'balanced' join: these are identified if
            // the token's balance ratio sans fee is larger than the weighted balance ratio, and swap fees charged
            // on the amount to swap
            if (weightedBalanceRatio >= tokenBalanceRatiosBeforeFee[i]) {
                tokenBalancePercentageExcess = 0;
            } else {
                tokenBalancePercentageExcess = tokenBalanceRatiosBeforeFee[i].sub(weightedBalanceRatio).div(
                    tokenBalanceRatiosBeforeFee[i].sub(FixedPoint.ONE)
                );
            }

            uint256 amountInAfterFee = amountsIn[i].mul(FixedPoint.ONE.sub(swapFee.mul(tokenBalancePercentageExcess)));

            tokenBalanceRatio = FixedPoint.ONE.add((amountInAfterFee).div(balances[i]));

            invariantRatio = invariantRatio.mul(
                LogExpMath.exp(int256(tokenBalanceRatio), int256(normalizedWeights[i])).toUint256()
            );
        }

        return bptTotalSupply.mul(invariantRatio.sub(FixedPoint.ONE));
    }

    function _tokenInForExactBPTOut(
        uint128 tokenBalance,
        uint256 tokenNormalizedWeight,
        uint256 bptAmountOut,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint128) {
        // Calculate the factor by which the invariant will increase after minting BPTAmountOut
        uint256 invariantRatio = bptTotalSupply.add(bptAmountOut).div(bptTotalSupply);

        // Calculate by how much the token balance has to increase to cause invariantRatio
        uint256 tokenBalanceRatio = LogExpMath
            .exp(int256(invariantRatio), int256(FixedPoint.ONE.div(tokenNormalizedWeight)))
            .toUint256();
        uint256 tokenBalancePercentageExcess = FixedPoint.ONE.sub(tokenNormalizedWeight);
        uint256 amountInAfterFee = tokenBalance.mul(tokenBalanceRatio.sub(FixedPoint.ONE));

        return amountInAfterFee.div(FixedPoint.ONE.sub(tokenBalancePercentageExcess.mul(swapFee))).toUint128();
    }

    function _exactBPTInForTokenOut(
        uint128 tokenBalance,
        uint256 tokenNormalizedWeight,
        uint256 bptAmountIn,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint128) {
        // Calculate the factor by which the invariant will increase after minting BPTAmountOut
        uint256 invariantRatio = bptTotalSupply.sub(bptAmountIn).div(bptTotalSupply);

        //TODO: review impact of exp math error that increases result
        // Calculate by how much the token balance has to increase to cause invariantRatio
        uint256 tokenBalanceRatio = LogExpMath
            .exp(int256(invariantRatio), int256(FixedPoint.ONE.div(tokenNormalizedWeight)))
            .toUint256();
        uint256 tokenBalancePercentageExcess = FixedPoint.ONE.sub(tokenNormalizedWeight);
        uint256 amountOutBeforeFee = tokenBalance.mul(FixedPoint.ONE.sub(tokenBalanceRatio));

        return amountOutBeforeFee.mul(FixedPoint.ONE.sub(tokenBalancePercentageExcess.mul(swapFee))).toUint128();
    }

    function _bptInForExactTokensOut(
        uint128[] memory balances,
        uint256[] memory normalizedWeights,
        uint128[] memory amountsOut,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        // First loop to calculate the weighted balance ratio
        uint256[] memory tokenBalanceRatiosBeforeFee = new uint256[](amountsOut.length);
        uint256 weightedBalanceRatio = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            tokenBalanceRatiosBeforeFee[i] = balances[i].sub(amountsOut[i]).div(balances[i]); //128
            weightedBalanceRatio = weightedBalanceRatio.add(tokenBalanceRatiosBeforeFee[i].mul(normalizedWeights[i]));
        }

        //Second loop to calculate new amounts in taking into account the fee on the % excess
        uint256 invariantRatio = FixedPoint.ONE;
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 tokenBalancePercentageExcess;
            uint256 tokenBalanceRatio;
            // For each ratioSansFee, compare with the total weighted ratio (weightedBalanceRatio) and
            // decrease the fee from what goes above it
            if (weightedBalanceRatio <= tokenBalanceRatiosBeforeFee[i]) {
                tokenBalancePercentageExcess = 0;
            } else {
                tokenBalancePercentageExcess = weightedBalanceRatio.sub(tokenBalanceRatiosBeforeFee[i]).div(
                    FixedPoint.ONE.sub(tokenBalanceRatiosBeforeFee[i])
                );
            }

            uint256 amountOutBeforeFee = amountsOut[i].div(
                FixedPoint.ONE.sub(swapFee.mul(tokenBalancePercentageExcess))
            );

            tokenBalanceRatio = FixedPoint.ONE.sub((amountOutBeforeFee).div(balances[i]));

            invariantRatio = invariantRatio.mul(
                LogExpMath.exp(int256(tokenBalanceRatio), int256(normalizedWeights[i])).toUint256()
            );
        }

        return bptTotalSupply.mul(FixedPoint.ONE.sub(invariantRatio));
    }
}
