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

import "../math/FixedPoint.sol";

// This is a contract to emulate file-level functions. Convert to a library
// after the migration to solc v0.7.1.

/* solhint-disable private-vars-leading-underscore */

contract ConstantWeightedProduct is FixedPoint {
    // Computes the spot price for a given pair (see https://balancer.finance/whitepaper/#spot-price)
    function spotPrice(
        uint256 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint256 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint256 swapFee
    ) public pure returns (uint256) {
        /**********************************************************************************************
        // spotPrice                                                                                 //
        // sP = spotPrice                                                                            //
        // bI = tokenBalanceIn                ( bI / wI )         1                                  //
        // bO = tokenBalanceOut         sP =  -----------  *  ----------                             //
        // wI = tokenWeightIn                 ( bO / wO )     ( 1 - sF )                             //
        // wO = tokenWeightOut                                                                       //
        // sF = swapFee                                                                              //
        /**********************************************************************************************/

        uint256 numerator = div(tokenBalanceIn, tokenWeightIn);
        uint256 denominator = div(tokenBalanceOut, tokenWeightOut);

        uint256 spotPriceSansFee = div(numerator, denominator);

        uint256 feeFactor = div(ONE, sub(ONE, swapFee));

        return mul(spotPriceSansFee, feeFactor);
    }

    // Computes how many tokens can be taken out of a pool if `tokenAmountIn` are sent, given the
    // current balances, weights and swap fee.
    function outGivenIn(
        uint256 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint256 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint256 tokenAmountIn,
        uint256 swapFee
    ) internal pure returns (uint256) {
        /**********************************************************************************************
        // outGivenIn                                                                                //
        // aO = tokenAmountOut                                                                       //
        // bO = tokenBalanceOut                                                                      //
        // bI = tokenBalanceIn              /      /            bI             \    (wI / wO) \      //
        // aI = tokenAmountIn    aO = bO * |  1 - | --------------------------  | ^            |     //
        // wI = tokenWeightIn               \      \ ( bI + ( aI * ( 1 - sF )) /              /      //
        // wO = tokenWeightOut                                                                       //
        // sF = swapFee                                                                              //
        **********************************************************************************************/

        uint256 adjustedIn = mul(tokenAmountIn, sub(ONE, swapFee));

        uint256 quotient = div(tokenBalanceIn, add(tokenBalanceIn, adjustedIn));
        uint256 weightRatio = div(tokenWeightIn, tokenWeightOut);

        uint256 ratio = sub(ONE, pow(quotient, weightRatio));

        return mul(tokenBalanceOut, ratio);
    }
}
