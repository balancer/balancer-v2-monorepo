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

import "../StableMath.sol";

contract MockStableMath {
    function invariant(
        uint256 amp,
        uint256[] memory balances
    ) external pure returns (uint256) {
        return StableMath._calculateInvariant(amp, balances);
    }

    function outGivenIn(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountIn
    ) external pure returns (uint256) {
        return
            StableMath._calcOutGivenIn(
                amp,
                balances,
                tokenIndexIn,
                tokenIndexOut,
                tokenAmountIn,
                StableMath._calculateInvariant(amp, balances)
            );
    }

    function inGivenOut(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountOut
    ) external pure returns (uint256) {
        return
            StableMath._calcInGivenOut(
                amp,
                balances,
                tokenIndexIn,
                tokenIndexOut,
                tokenAmountOut,
                StableMath._calculateInvariant(amp, balances)
            );
    }

    function exactTokensInForBPTOut(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsIn,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) external pure returns (uint256) {
        return StableMath._calcBptOutGivenExactTokensIn(amp, balances, amountsIn, bptTotalSupply, swapFee);
    }

    function tokenInForExactBPTOut(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndex,
        uint256 bptAmountOut,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) external pure returns (uint256) {
        return
            StableMath._calcTokenInGivenExactBptOut(amp, balances, tokenIndex, bptAmountOut, bptTotalSupply, swapFee);
    }

    function exactBPTInForTokenOut(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndex,
        uint256 bptAmountIn,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) external pure returns (uint256) {
        return StableMath._calcTokenOutGivenExactBptIn(amp, balances, tokenIndex, bptAmountIn, bptTotalSupply, swapFee);
    }

    function exactBPTInForTokensOut(
        uint256[] memory balances,
        uint256 bptAmountIn,
        uint256 bptTotalSupply
    ) external pure returns (uint256[] memory) {
        return StableMath._calcTokensOutGivenExactBptIn(balances, bptAmountIn, bptTotalSupply);
    }

    function bptInForExactTokensOut(
        uint256 amp,
        uint256[] memory balances,
        uint256[] memory amountsOut,
        uint256 bptTotalSupply,
        uint256 swapFee
    ) external pure returns (uint256) {
        return StableMath._calcBptInGivenExactTokensOut(amp, balances, amountsOut, bptTotalSupply, swapFee);
    }

    function calculateDueTokenProtocolSwapFeeAmount(
        uint256 amp,
        uint256[] memory balances,
        uint256 lastInvariant,
        uint256 tokenIndex,
        uint256 protocolSwapFeePercentage
    ) external pure returns (uint256) {
        return
            StableMath._calcDueTokenProtocolSwapFeeAmount(
                amp,
                balances,
                lastInvariant,
                tokenIndex,
                protocolSwapFeePercentage
            );
    }
}
