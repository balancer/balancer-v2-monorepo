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

import "../strategies/lib/WeightedProduct.sol";
import "../strategies/WeightedProdStrategy.sol";

import "./ITradeScript.sol";

// This is a contract to emulate file-level functions. Convert to a library
// after the migration to solc v0.7.1.

abstract contract PairTradeScript is ITradeScript, WeightedProduct {
    using SafeCast for uint256;
    using SafeCast for int256;
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    // Data required to compute a trade
    struct PairPoolData {
        uint128 tokenInBalance;
        uint256 tokenInDenorm;
        uint128 tokenOutBalance;
        uint256 tokenOutDenorm;
        uint256 swapFee;
    }

    function _getPoolData(
        IVault vault,
        bytes32 poolId,
        address strategy,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) private view returns (PairPoolData memory) {
        // TODO: reduce to a single contract call - will depend on the curve abstraction

        IERC20[] memory tokens = new IERC20[](2);
        tokens[0] = tokenIn;
        tokens[1] = tokenOut;

        uint128[] memory tokenBalances = vault.getPoolTokenBalances(poolId, tokens);

        uint256 tokenInDenormalizedWeight = WeightedProdStrategy(strategy).getWeight(tokenIn);
        uint256 tokenOutDenormalizedWeight = WeightedProdStrategy(strategy).getWeight(tokenOut);

        uint256 swapFee = WeightedProdStrategy(strategy).getSwapFee();

        return
            PairPoolData({
                tokenInBalance: tokenBalances[0],
                tokenInDenorm: tokenInDenormalizedWeight,
                tokenOutBalance: tokenBalances[1],
                tokenOutDenorm: tokenOutDenormalizedWeight,
                swapFee: swapFee
            });
    }

    function _getExactAmountInData(
        IVault vault,
        address strategy,
        IVault.Swap memory swap,
        IERC20[] memory tokens,
        IERC20 overallTokenIn,
        uint128 amountIn,
        Helper memory helper
    ) internal view returns (Helper memory) {
        IERC20 tokenIn = tokens[swap.tokenIn.tokenIndex];
        IERC20 tokenOut = tokens[swap.tokenOut.tokenIndex];

        PairPoolData memory poolData = _getPoolData(vault, swap.poolId, strategy, tokenIn, tokenOut);

        // If not equal, we could add a sanity check by requiring
        // tokenIn == lasToken && amountsIn[i] == 0
        amountIn = (tokenIn == overallTokenIn) ? amountIn : helper.amountCalculated;

        //Substract fee
        uint128 adjustedIn = amountIn.sub128(amountIn.mul128(uint128(poolData.swapFee)));

        uint128 amountOut = WeightedProduct._outGivenIn(
            poolData.tokenInBalance,
            poolData.tokenInDenorm,
            poolData.tokenOutBalance,
            poolData.tokenOutDenorm,
            adjustedIn
        );

        return
            Helper({
                toSend: helper.toSend,
                toReceive: helper.toReceive,
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountUsedToCalculate: amountIn,
                amountCalculated: amountOut
            });
    }

    function _getExactAmountOutData(
        IVault vault,
        address strategy,
        IVault.Swap memory swap,
        IERC20[] memory tokens,
        IERC20 overallTokenOut,
        uint128 amountOut,
        Helper memory helper
    ) internal view returns (Helper memory) {
        IERC20 tokenIn = tokens[swap.tokenIn.tokenIndex];
        IERC20 tokenOut = tokens[swap.tokenOut.tokenIndex];

        PairPoolData memory poolData = _getPoolData(vault, swap.poolId, strategy, tokenIn, tokenOut);

        // If not equal, we could add a sanity check by requiring
        // tokenOut == lasToken && amountsOut[i] == 0
        amountOut = (tokenOut == overallTokenOut) ? amountOut : helper.amountCalculated;

        uint128 amountIn = WeightedProduct._inGivenOut(
            poolData.tokenInBalance,
            poolData.tokenInDenorm,
            poolData.tokenOutBalance,
            poolData.tokenOutDenorm,
            amountOut
        );

        //Calculated fee, to be later used as tokenAmountIn = adjustedIn * (1 - fee)
        amountIn = amountIn.div128(FixedPoint.ONE.sub128(uint128(poolData.swapFee)));

        return
            Helper({
                toSend: helper.toSend,
                toReceive: helper.toReceive,
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountUsedToCalculate: amountOut,
                amountCalculated: amountIn
            });
    }
}
