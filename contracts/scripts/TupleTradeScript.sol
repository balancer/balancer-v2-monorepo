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

import "./ITradeScript.sol";

import "../strategies/lib/Stable.sol";
import "../strategies/StableStrategy.sol";

// This is a contract to emulate file-level functions. Convert to a library
// after the migration to solc v0.7.1.

// solhint-disable private-vars-leading-underscore
// solhint-disable var-name-mixedcase

abstract contract TupleTradeScript is ITradeScript, Stable {
    using SafeCast for uint256;
    using SafeCast for int256;
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    // Data required to compute a trade
    struct TuplePoolData {
        address tokenIn;
        address tokenOut;
        uint128 tokenInBalance;
        uint128 tokenOutBalance;
        uint128 amp;
        uint256 swapFee;
        uint128[] balances;
    }

    function _getPoolData(
        IVault vault,
        bytes32 poolId,
        address strategy,
        address tokenIn,
        address tokenOut,
        SwapTokenIndexes memory indexes
    ) private view returns (TuplePoolData memory) {
        // TODO: reduce to a single contract call - will depend on the curve abstraction

        uint128 amp = StableStrategy(strategy).getAmp();

        uint256 swapFee = StableStrategy(strategy).getSwapFee();

        address[] memory tokens = vault.getPoolTokens(poolId);
        uint128[] memory tokenBalances = vault.getPoolTokenBalances(
            poolId,
            tokens
        );

        return
            TuplePoolData({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                tokenInBalance: tokenBalances[indexes.tokenIndexIn],
                tokenOutBalance: tokenBalances[indexes.tokenIndexOut],
                amp: amp,
                swapFee: swapFee,
                balances: tokenBalances
            });
    }

    function _getExactAmountInData(
        IVault vault,
        address strategy,
        IVault.Diff[] memory diffs,
        IVault.Swap memory swap,
        SwapTokenIndexes memory indexes,
        address overallTokenIn,
        uint128 amountIn,
        Helper memory helper
    ) internal view returns (Helper memory) {
        address tokenIn = diffs[swap.tokenIn.tokenDiffIndex].token;
        address tokenOut = diffs[swap.tokenOut.tokenDiffIndex].token;

        TuplePoolData memory poolData = _getPoolData(
            vault,
            swap.poolId,
            strategy,
            tokenIn,
            tokenOut,
            indexes
        );

        // If not equal, we could add a sanity check by requiring
        // tokenIn == lasToken && amountsIn[i] == 0
        amountIn = (poolData.tokenIn == overallTokenIn)
            ? amountIn
            : helper.amountCalculated;

        //Substract fee
        uint128 adjustedIn = amountIn.sub128(
            amountIn.mul128(uint128(poolData.swapFee))
        );

        uint128 amountOut = Stable._outGivenIn(
            poolData.amp,
            poolData.balances,
            indexes.tokenIndexIn,
            indexes.tokenIndexOut,
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
        IVault.Diff[] memory diffs,
        IVault.Swap memory swap,
        SwapTokenIndexes memory indexes,
        address overallTokenOut,
        uint128 amountOut,
        Helper memory helper
    ) internal view returns (Helper memory) {
        address tokenIn = diffs[swap.tokenIn.tokenDiffIndex].token;
        address tokenOut = diffs[swap.tokenOut.tokenDiffIndex].token;

        TuplePoolData memory poolData = _getPoolData(
            vault,
            swap.poolId,
            strategy,
            tokenIn,
            tokenOut,
            indexes
        );

        // If not equal, we could add a sanity check by requiring
        // tokenOut == lasToken && amountsOut[i] == 0
        amountOut = (tokenOut == overallTokenOut)
            ? amountOut
            : helper.amountCalculated;

        uint128 amountIn = _inGivenOut(
            poolData.amp,
            poolData.balances,
            indexes.tokenIndexIn,
            indexes.tokenIndexOut,
            amountOut
        );

        //Calculated fee, to be later used as tokenAmountIn = adjustedIn * (1 - fee)
        amountIn = amountIn.div128(
            FixedPoint.ONE.sub128(uint128(poolData.swapFee))
        );

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
