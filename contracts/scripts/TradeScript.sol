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

pragma experimental ABIEncoderV2;

pragma solidity ^0.7.1;

import "hardhat/console.sol";

import "./ITradeScript.sol";
import "./PairTradeScript.sol";
import "./TupleTradeScript.sol";

contract TradeScript is ITradeScript, PairTradeScript, TupleTradeScript {
    using SafeCast for uint256;
    using SafeCast for int256;
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    // Trades overallTokenIn for overallTokenOut, possibly going through intermediate tokens.
    // At least minAmountOut overallTokenOut tokens will be obtained, with a maximum effective
    // of maxPrice (including trading fees). The amount of overallTokenIn to be sent for each
    // swap is specified in amountsIn.
    // If the tokenIn for a swap is not overallTokenIn, the output of the previous swap is used
    // instead (multi-hops). Subsequent non-overallTokenOut outputs are merged together (merge-hop).
    function swapExactAmountIn(
        OverallInfoIn memory info,
        IVault.Swap[] memory swaps,
        IERC20[] memory tokens,
        SwapTokenIndexes[] memory indexes,
        uint128[] memory amountsIn,
        bool withdrawTokens
    ) public override {
        Helper memory helper;

        for (uint256 i = 0; i < swaps.length; ++i) {
            (address strategy, IVault.StrategyType strategyType) = _vault.getPoolStrategy(swaps[i].poolId);

            if (strategyType == IVault.StrategyType.PAIR) {
                helper = PairTradeScript._getExactAmountInData(
                    _vault,
                    strategy,
                    swaps[i],
                    tokens,
                    info.overallTokenIn,
                    amountsIn[i],
                    helper
                );
            } else if (strategyType == IVault.StrategyType.TUPLE) {
                helper = TupleTradeScript._getExactAmountInData(
                    _vault,
                    strategy,
                    swaps[i],
                    tokens,
                    indexes[i],
                    info.overallTokenIn,
                    amountsIn[i],
                    helper
                );
            } else {
                revert("Unknown strategy type");
            }

            // TODO: do we need overflow safe arithmetic? Could skip those for gas savings, since the user
            // provides the inputs
            if (helper.tokenIn == info.overallTokenIn) {
                helper.toSend += helper.amountUsedToCalculate;
            }

            if (helper.tokenOut == info.overallTokenOut) {
                helper.toReceive += helper.amountCalculated;
            }

            // Configure pool end state

            // TODO: check overflow (https://docs.openzeppelin.com/contracts/3.x/api/utils#SafeCast-toInt256-uint256-)
            swaps[i].tokenIn.amount = helper.amountUsedToCalculate;
            swaps[i].tokenOut.amount = helper.amountCalculated;
        }

        require(helper.toReceive >= info.minAmountOut, "Insufficient amount out");
        require(helper.toSend.div(helper.toReceive) <= info.maxPrice, "Price too high");

        for (uint256 i = 0; i < tokens.length; ++i) {
            if (tokens[i] == info.overallTokenIn) {
                amountsIn[i] = helper.toSend;
                break;
            }
        }

        _vault.batchSwap(
            swaps,
            tokens,
            IVault.FundsIn({ withdrawFrom: msg.sender, amounts: amountsIn }),
            IVault.FundsOut({ recipient: msg.sender, transferToRecipient: withdrawTokens })
        );

        // TODO: check recipient balance increased by helper.toReceive? This should never fail if engine is correct
    }

    // Trades overallTokenIn for overallTokenOut, possibly going through intermediate tokens.
    // At most maxAmountOut tokens will be spent, with a maximum effective
    // of maxPrice (including trading fees). The amount of overallTokenOut to be received in each
    // swap is specified in amountsOut.
    // If the tokenOut for a swap is not overallTokenOut, the input of the previous swap is used
    // instead (multi-hops).
    // MaxPrice argument can be calculated by the sum of amountsOut and the maxAmountIn arg,
    // but it is redundant as a secure and simple check.
    function swapExactAmountOut(
        OverallInfoOut memory info,
        IVault.Swap[] memory swaps,
        IERC20[] memory tokens,
        SwapTokenIndexes[] memory indexes,
        uint128[] memory amountsOut,
        bool withdrawTokens
    ) public override {
        Helper memory helper;

        for (uint256 i = 0; i < swaps.length; ++i) {
            (address strategy, IVault.StrategyType strategyType) = _vault.getPoolStrategy(swaps[i].poolId);

            if (strategyType == IVault.StrategyType.PAIR) {
                helper = PairTradeScript._getExactAmountOutData(
                    _vault,
                    strategy,
                    swaps[i],
                    tokens,
                    info.overallTokenOut,
                    amountsOut[i],
                    helper
                );
            } else if (strategyType == IVault.StrategyType.TUPLE) {
                helper = TupleTradeScript._getExactAmountOutData(
                    _vault,
                    strategy,
                    swaps[i],
                    tokens,
                    indexes[i],
                    info.overallTokenOut,
                    amountsOut[i],
                    helper
                );
            } else {
                revert("Unknown strategy type");
            }

            // TODO: do we need overflow safe arithmetic? Could skip those for gas savings, since the user
            // provides the inputs
            if (helper.tokenIn == info.overallTokenIn) {
                helper.toSend += helper.amountCalculated;
            }

            if (helper.tokenOut == info.overallTokenOut) {
                helper.toReceive += helper.amountUsedToCalculate;
            }

            // Configure pool end state

            // TODO: check overflow (https://docs.openzeppelin.com/contracts/3.x/api/utils#SafeCast-toInt256-uint256-)
            swaps[i].tokenIn.amount = helper.amountCalculated;
            swaps[i].tokenOut.amount = helper.amountUsedToCalculate;
        }

        require(helper.toSend <= info.maxAmountIn, "Excessing amount in");
        require(helper.toSend.div(helper.toReceive) <= info.maxPrice, "Price too high");

        uint128[] memory amountsIn = new uint128[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            if (tokens[i] == info.overallTokenIn) {
                amountsIn[i] = helper.toSend;
                break;
            }
        }

        _vault.batchSwap(
            swaps,
            tokens,
            IVault.FundsIn({ withdrawFrom: msg.sender, amounts: amountsIn }),
            IVault.FundsOut({ recipient: msg.sender, transferToRecipient: withdrawTokens })
        );

        // TODO: check recipient balance increased by helper.toReceive? This should never fail if engine is correct
    }
}
