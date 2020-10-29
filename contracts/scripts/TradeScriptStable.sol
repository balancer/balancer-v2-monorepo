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

import "hardhat/console.sol";

import "../strategies/lib/Stable.sol";
import "../strategies/StableStrategy.sol";

import "../IVault.sol";
import "../ISwapCaller.sol";

contract TradeScriptStable is Stable, ISwapCaller {
    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    // Data required to compute a trade
    struct PoolData {
        address tokenIn;
        address tokenOut;
        uint256 tokenInBalance;
        uint256 tokenOutBalance;
        uint256 amp;
        uint256 swapFee;
        uint256[] balances;
    }

    function _getPoolData(IVault.Diff[] memory diffs, IVault.Swap memory swap)
        private
        view
        returns (PoolData memory)
    {
        // TODO: reduce to a single contract call - will depend on the curve abstraction

        address tokenIn = diffs[swap.tokenA.tokenDiffIndex].token;
        address tokenOut = diffs[swap.tokenB.tokenDiffIndex].token;

        address[] memory addresses = new address[](2);
        addresses[0] = tokenIn;
        addresses[1] = tokenOut;

        uint256[] memory tokenBalances = _vault.getPoolTokenBalances(
            swap.poolId,
            addresses
        );

        (address strategy, ) = _vault.getStrategy(swap.poolId);

        uint256 amp = StableStrategy(strategy).getAmp();

        uint256 swapFee = StableStrategy(strategy).getSwapFee();

        address[] memory tokens = IVault(_vault).getPoolTokens(swap.poolId);
        uint256[] memory balances = IVault(_vault).getPoolTokenBalances(
            swap.poolId,
            tokens
        );

        return
            PoolData({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                tokenInBalance: tokenBalances[0],
                tokenOutBalance: tokenBalances[1],
                amp: amp,
                swapFee: swapFee,
                balances: balances
            });
    }

    // Used to store data in memory and avoid stack-too-deep errors
    struct Helper {
        uint256 toSend;
        uint256 toReceive;
    }

    struct SwapTokenIndexes {
        uint256 tokenIndexIn;
        uint256 tokenIndexOut;
    }

    // Trades overallTokenIn for overallTokenOut, possibly going through intermediate tokens.
    // At least minAmountOut overallTokenOut tokens will be obtained, with a maximum effective
    // of maxPrice (including trading fees). The amount of overallTokenIn to be sent for each
    // swap is specified in amountsIn.
    // If the tokenIn for a swap is not overallTokenIn, the output of the previous swap is used
    // instead (multi-hops). Subsequent non-overallTokenOut outputs are merged together (merge-hop).
    function swapExactAmountIn(
        address overallTokenIn,
        address overallTokenOut,
        uint256 minAmountOut,
        uint256 maxPrice,
        IVault.Diff[] memory diffs,
        IVault.Swap[] memory swaps,
        SwapTokenIndexes[] memory indexes,
        uint256[] memory amountsIn,
        bool withdrawTokens
    ) public {
        Helper memory helper;

        uint256 tokenAmountOut;

        for (uint256 i = 0; i < swaps.length; ++i) {
            PoolData memory poolData = _getPoolData(diffs, swaps[i]);

            // If not equal, we could add a sanity check by requiring
            // tokenIn == lasToken && amountsIn[i] == 0
            uint256 amountIn = (poolData.tokenIn == overallTokenIn)
                ? amountsIn[i]
                : tokenAmountOut;

            tokenAmountOut = _outGivenIn(
                poolData.amp,
                poolData.balances,
                indexes[i].tokenIndexIn,
                indexes[i].tokenIndexOut,
                sub(amountIn, mul(amountIn, poolData.swapFee))
            );

            // TODO: do we need overflow safe arithmetic? Could skip those for gas savings, since the user
            // provides the inputs
            if (poolData.tokenIn == overallTokenIn) {
                helper.toSend += amountIn;
            }

            if (poolData.tokenOut == overallTokenOut) {
                helper.toReceive += tokenAmountOut;
            }

            // Configure pool end state

            // TODO: check overflow (https://docs.openzeppelin.com/contracts/3.x/api/utils#SafeCast-toInt256-uint256-)
            swaps[i].tokenA.delta = int256(amountIn);
            swaps[i].tokenB.delta = -int256(tokenAmountOut);
        }

        require(helper.toReceive >= minAmountOut, "Insufficient amount out");
        require(
            div(helper.toSend, helper.toReceive) <= maxPrice,
            "Price too high"
        );

        bytes memory callbackData = abi.encode(
            msg.sender,
            overallTokenIn,
            helper.toSend
        );

        _vault.batchSwap(
            diffs,
            swaps,
            IVault.FundsIn({
                withdrawFrom: msg.sender,
                callbackData: callbackData
            }),
            IVault.FundsOut({
                recipient: msg.sender,
                transferToRecipient: withdrawTokens
            })
        );

        // TODO: check recipient balance increased by helper.toReceive? This should never fail if engine is correct
    }

    // Callback to send tokens to the Vault
    function sendTokens(bytes calldata callbackData) external override {
        require(msg.sender == address(_vault), "Invalid callback caller");

        (address sender, address overallTokenIn, uint256 toSend) = abi.decode(
            callbackData,
            (address, address, uint256)
        );
        IERC20(overallTokenIn).transferFrom(sender, address(_vault), toSend);
    }
}
