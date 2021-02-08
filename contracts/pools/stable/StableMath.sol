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

import "../../lib/math/FixedPoint.sol";

// This is a contract to emulate file-level functions. Convert to a library
// after the migration to solc v0.7.1.

// solhint-disable private-vars-leading-underscore
// solhint-disable var-name-mixedcase

contract StableMath {
    using FixedPoint for uint256;

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
            sum = sum + balances[i];
        }
        if (sum == 0) {
            return 0;
        }
        uint256 prevInv = 0;
        uint256 inv = sum;
        uint256 ampTimesTotal = amp * totalCoins;

        for (uint256 i = 0; i < 255; i++) {
            uint256 P_D = totalCoins * balances[0];
            for (uint256 j = 1; j < totalCoins; j++) {
                P_D = (P_D * balances[j] * totalCoins) / inv;
            }
            prevInv = inv;
            inv =
                (totalCoins * inv * inv + ampTimesTotal * sum * P_D) /
                ((totalCoins + 1) * inv + (ampTimesTotal - 1) * P_D);
            // Equality with the precision of 1

            if (inv > prevInv) {
                if ((inv - prevInv) <= 1) {
                    break;
                }
            } else if ((prevInv - inv) <= 1) {
                break;
            }
        }
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
        uint256 inv = _invariant(amp, balances);
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 nn = 1;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            if (i == tokenIndexOut) {
                x = balances[i] - tokenAmountOut;
            } else if (i != tokenIndexIn) {
                x = balances[i];
            } else {
                continue;
            }
            sum += x;
            nn = totalCoins * totalCoins;
            p = (p * inv) / x;
        }
        p = (p * inv) / (amp * nn * nn);
        uint256 b = sum + inv / (amp * nn);
        uint256 y = ((inv - b) + FixedPoint.sqrt((inv - b) * (inv - b) + 4 * p)) / 2;
        return (y - balances[tokenIndexIn] + 1);
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
        uint256 inv = _invariant(amp, balances);
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 nn = 1;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            if (i == tokenIndexIn) {
                x = balances[i] + tokenAmountIn;
            } else if (i != tokenIndexOut) {
                x = balances[i];
            } else {
                continue;
            }
            sum += x;
            nn = totalCoins * totalCoins;
            p = (p * inv) / x;
        }
        p = (p * inv) / (amp * nn * nn);
        uint256 b = sum + inv / (amp * nn);
        uint256 y = ((inv - b) + FixedPoint.sqrt((inv - b) * (inv - b) + 4 * p)) / 2;
        return (balances[tokenIndexOut] - y - 1);
    }

    function _allTokensInForExactBPTOut(
        uint256[] memory currentBalances,
        uint256 bptAmountOut,
        uint256 totalBPT
    ) internal pure returns (uint256[] memory) {
        /**********************************************************************************************
        // allTokensInForExactBPTOut                                                                 //
        // (per token)                                                                               //
        // aI = tokenAmountIn              /        bptOut         \                                 //
        // b = tokenBalance      aI = b * | ---------------------  |                                 //
        // bptOut = bptAmountOut           \       totalBPT       /                                  //
        // bpt = totalBPT                                                                            //
        **********************************************************************************************/

        // Since we're computing an amount in, we round up overall. This means rouding up on both the multiplication and
        // division.

        uint256 bptRatio = bptAmountOut.divUp(totalBPT);

        uint256[] memory amountsOut = new uint256[](currentBalances.length);
        for (uint256 i = 0; i < currentBalances.length; i++) {
            amountsOut[i] = currentBalances[i].mulUp(bptRatio);
        }

        return amountsOut;
    }

    function _exactBPTInForAllTokensOut(
        uint256[] memory currentBalances,
        uint256 bptAmountIn,
        uint256 totalBPT
    ) internal pure returns (uint256[] memory) {
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

        uint256 inv = lastInvariant;
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 nn = 1;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            if (i != tokenIndex) {
                x = balances[i];
            } else {
                continue;
            }
            sum += x;
            nn = totalCoins * totalCoins;
            p = (p * inv) / x;
        }
        p = (p * inv) / (amp * nn * nn);
        uint256 b = sum + inv / (amp * nn);
        uint256 y = ((inv - b) + FixedPoint.sqrt((inv - b) * (inv - b) + 4 * p)) / 2;

        uint256 accumulatedTokenSwapFees = (balances[tokenIndex] - y - 1);
        return accumulatedTokenSwapFees.mulDown(protocolSwapFeePercentage);
    }
}
