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
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";

import "hardhat/console.sol";

import "../strategies/lib/WeightedProduct.sol";
import "../strategies/WeightedProdStrategy.sol";

import "../vault/IVault.sol";

import "../math/FixedPoint.sol";

contract TradeScript is WeightedProduct {
    using SafeCast for uint256;
    using SafeCast for int256;
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    // Data required to compute a trade
    struct PoolData {
        uint256 tokenInBalance;
        uint256 tokenInDenorm;
        uint256 tokenOutBalance;
        uint256 tokenOutDenorm;
        uint256 swapFee;
    }

    function _getPoolData(
        bytes32 poolId,
        address tokenIn,
        address tokenOut
    ) private view returns (PoolData memory) {
        // TODO: reduce to a single contract call - will depend on the curve abstraction

        address[] memory addresses = new address[](2);
        addresses[0] = tokenIn;
        addresses[1] = tokenOut;

        uint128[] memory tokenBalances = _vault.getPoolTokenBalances(
            poolId,
            addresses
        );

        (address strategy, ) = _vault.getStrategy(poolId);

        uint256 tokenInDenormalizedWeight = WeightedProdStrategy(strategy)
            .getWeight(tokenIn);
        uint256 tokenOutDenormalizedWeight = WeightedProdStrategy(strategy)
            .getWeight(tokenOut);

        uint256 swapFee = WeightedProdStrategy(strategy).getSwapFee();

        return
            PoolData({
                tokenInBalance: tokenBalances[0],
                tokenInDenorm: tokenInDenormalizedWeight,
                tokenOutBalance: tokenBalances[1],
                tokenOutDenorm: tokenOutDenormalizedWeight,
                swapFee: swapFee
            });
    }

    // Used to store data in memory and avoid stack-too-deep errors
    struct Helper {
        uint256 toSend;
        uint256 toReceive;
        uint128 lastTokenCalculatedAmount;
    }

    // Trades overallTokenIn for overallTokenOut, possibly going through intermediate tokens.
    // At least minAmountOut overallTokenOut tokens will be obtained, with a maximum effective
    // of maxPrice (including trading fees). The amount of overallTokenIn to be sent for each
    // swap is specified in amountsIn.
    // If the tokenIn for a swap is not overallTokenIn, the output of the previous swap is used
    // instead (multi-hops).
    // MaxPrice argument can be calculated by the sum of amountsIn and the minAmountOut arg,
    // but it is redundant as a secure and simple check.
    function swapExactAmountIn(
        address overallTokenIn,
        address overallTokenOut,
        uint128 minAmountOut,
        uint256 maxPrice,
        IVault.Diff[] memory diffs,
        IVault.Swap[] memory swaps,
        uint128[] memory amountsIn,
        bool withdrawTokens
    ) public {
        Helper memory helper;

        for (uint256 i = 0; i < swaps.length; ++i) {
            address tokenIn = diffs[swaps[i].tokenIn.tokenDiffIndex].token;
            address tokenOut = diffs[swaps[i].tokenOut.tokenDiffIndex].token;

            PoolData memory poolData = _getPoolData(
                swaps[i].poolId,
                tokenIn,
                tokenOut
            );

            // If not equal, we could add a sanity check by requiring
            // tokenIn == lasToken && amountsIn[i] == 0
            uint128 amountIn = (tokenIn == overallTokenIn)
                ? amountsIn[i]
                : helper.lastTokenCalculatedAmount;

            //Substract fee
            uint128 adjustedIn = amountIn.sub128(
                amountIn.mul128(uint128(poolData.swapFee))
            );

            helper.lastTokenCalculatedAmount = _outGivenIn(
                poolData.tokenInBalance.toUint128(),
                poolData.tokenInDenorm,
                poolData.tokenOutBalance.toUint128(),
                poolData.tokenOutDenorm,
                adjustedIn
            );

            // TODO: do we need overflow safe arithmetic? Could skip those for gas savings, since the user
            // provides the inputs
            if (tokenIn == overallTokenIn) {
                helper.toSend += amountIn;
            }

            if (tokenOut == overallTokenOut) {
                helper.toReceive += helper.lastTokenCalculatedAmount;
            }

            // Configure pool end state

            // TODO: check overflow (https://docs.openzeppelin.com/contracts/3.x/api/utils#SafeCast-toInt256-uint256-)
            swaps[i].tokenIn.amount = amountIn;
            swaps[i].tokenOut.amount = helper.lastTokenCalculatedAmount;
        }

        require(helper.toReceive >= minAmountOut, "Insufficient amount out");
        require(
            helper.toSend.div(helper.toReceive) <= maxPrice,
            "Price too high"
        );

        for (uint256 i = 0; i < diffs.length; ++i) {
            if (diffs[i].token == overallTokenIn) {
                diffs[i].amountIn = helper.toSend;
                break;
            }
        }

        _vault.batchSwap(
            diffs,
            swaps,
            IVault.FundsIn({ withdrawFrom: msg.sender }),
            IVault.FundsOut({
                recipient: msg.sender,
                transferToRecipient: withdrawTokens
            })
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
        address overallTokenIn,
        address overallTokenOut,
        uint128 maxAmountIn,
        uint256 maxPrice,
        IVault.Diff[] memory diffs,
        IVault.Swap[] memory swaps,
        uint128[] memory amountsOut,
        bool withdrawTokens
    ) public {
        Helper memory helper;

        for (uint256 i = 0; i < swaps.length; ++i) {
            address tokenIn = diffs[swaps[i].tokenIn.tokenDiffIndex].token;
            address tokenOut = diffs[swaps[i].tokenOut.tokenDiffIndex].token;

            PoolData memory poolData = _getPoolData(
                swaps[i].poolId,
                tokenIn,
                tokenOut
            );

            // If not equal, we could add a sanity check by requiring
            // tokenOut == lasToken && amountsOut[i] == 0
            uint128 amountOut = (tokenOut == overallTokenOut)
                ? amountsOut[i]
                : helper.lastTokenCalculatedAmount;

            uint128 tokenAmountIn = _inGivenOut(
                poolData.tokenInBalance.toUint128(),
                poolData.tokenInDenorm,
                poolData.tokenOutBalance.toUint128(),
                poolData.tokenOutDenorm,
                amountOut
            );

            //Calculated fee, to be later used as tokenAmountIn = adjustedIn * (1 - fee)
            helper.lastTokenCalculatedAmount = tokenAmountIn.div128(
                FixedPoint.ONE.sub128(uint128(poolData.swapFee))
            );

            // TODO: do we need overflow safe arithmetic? Could skip those for gas savings, since the user
            // provides the inputs
            if (tokenIn == overallTokenIn) {
                helper.toSend += helper.lastTokenCalculatedAmount;
            }

            if (tokenOut == overallTokenOut) {
                helper.toReceive += amountOut;
            }

            // Configure pool end state

            // TODO: check overflow (https://docs.openzeppelin.com/contracts/3.x/api/utils#SafeCast-toInt256-uint256-)
            swaps[i].tokenIn.amount = helper.lastTokenCalculatedAmount;
            swaps[i].tokenOut.amount = amountOut;
        }

        require(helper.toSend <= maxAmountIn, "Excessing amount out");
        require(
            helper.toSend.div(helper.toReceive) <= maxPrice,
            "Price too high"
        );

        for (uint256 i = 0; i < diffs.length; ++i) {
            if (diffs[i].token == overallTokenIn) {
                diffs[i].amountIn = helper.toSend;
                break;
            }
        }

        _vault.batchSwap(
            diffs,
            swaps,
            IVault.FundsIn({ withdrawFrom: msg.sender }),
            IVault.FundsOut({
                recipient: msg.sender,
                transferToRecipient: withdrawTokens
            })
        );

        // TODO: check recipient balance increased by helper.toReceive? This should never fail if engine is correct
    }
}
