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

import "../../lib/math/Math.sol";
import "../../lib/math/FixedPoint.sol";

// This is a contract to emulate file-level functions. Convert to a library
// after the migration to solc v0.7.1.

// solhint-disable private-vars-leading-underscore
// solhint-disable var-name-mixedcase

contract StableMath {
    using Math for uint256;

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
            sum = sum.add(balances[i]);
        }
        if (sum == 0) {
            return 0;
        }
        uint256 prevInv = 0;
        uint256 inv = sum;
        uint256 ampTimesTotal = amp.mul(totalCoins);

        for (uint256 i = 0; i < 255; i++) {
            uint256 P_D = totalCoins.mul(balances[0]);
            for (uint256 j = 1; j < totalCoins; j++) {
                //P_D is rounded up
                P_D = P_D.mul(balances[j]).mul(totalCoins).divUp(inv);
            }
            prevInv = inv;
            //inv is rounded up
            inv = totalCoins.mul(inv).mul(inv).add(ampTimesTotal.mul(sum).mul(P_D)).divUp(
                totalCoins.add(1).mul(inv).add((ampTimesTotal.sub(1).mul(P_D)))
            );
            // Equality with the precision of 1
            if (inv > prevInv) {
                if ((inv.sub(prevInv)) <= 1) {
                    break;
                }
            } else if ((prevInv.sub(inv)) <= 1) {
                break;
            }
        }
        //Result is rounded up
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
        //Invariant is rounded up
        uint256 inv = _invariant(amp, balances);
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 nn = 1;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            if (i == tokenIndexOut) {
                x = balances[i].sub(tokenAmountOut);
            } else if (i != tokenIndexIn) {
                x = balances[i];
            } else {
                continue;
            }
            sum = sum.add(x);
            nn = totalCoins.mul(totalCoins);
            //Round up p
            p = p.mul(inv).divUp(x);
        }

        //Calculate in balance
        uint256 y = _solveAnalyticalBalance(sum, inv, amp, nn, p);

        //Result is rounded up
        return y.sub(balances[tokenIndexIn]);
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
        //Invariant is rounded up
        uint256 inv = _invariant(amp, balances);
        uint256 p = inv;
        uint256 sum = 0;
        uint256 totalCoins = balances.length;
        uint256 nn = 1;
        uint256 x = 0;
        for (uint256 i = 0; i < totalCoins; i++) {
            if (i == tokenIndexIn) {
                x = balances[i].add(tokenAmountIn);
            } else if (i != tokenIndexOut) {
                x = balances[i];
            } else {
                continue;
            }
            sum = sum.add(x);
            nn = totalCoins.mul(totalCoins);
            //Round up p
            p = p.mul(inv).divUp(x);
        }

        //Calculate out balance
        uint256 y = _solveAnalyticalBalance(sum, inv, amp, nn, p);

        //Result is rounded down
        return balances[tokenIndexOut] > y ? balances[tokenIndexOut].sub(y) : 0;
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

        uint256[] memory amountsOut = new uint256[](currentBalances.length);
        for (uint256 i = 0; i < currentBalances.length; i++) {
            amountsOut[i] = currentBalances[i].mul(bptAmountOut).divUp(totalBPT);
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

        uint256[] memory amountsOut = new uint256[](currentBalances.length);
        for (uint256 i = 0; i < currentBalances.length; i++) {
            amountsOut[i] = currentBalances[i].mul(bptAmountIn).divDown(totalBPT);
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

        //Last invariant is rounded up
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
            sum = sum.add(x);
            nn = totalCoins.mul(totalCoins);
            //Round up p
            p = p.mul(inv).divUp(x);
        }

        //Calculate token balance balance
        uint256 y = _solveAnalyticalBalance(sum, inv, amp, nn, p);

        //Result is rounded down
        uint256 accumulatedTokenSwapFees = balances[tokenIndex] > y ? balances[tokenIndex].sub(y) : 0;
        return accumulatedTokenSwapFees.mul(protocolSwapFeePercentage).divUp(FixedPoint.ONE);
    }

    //Private functions

    //This function calcuates the analytical solution to find the balance required
    function _solveAnalyticalBalance(
        uint256 sum,
        uint256 inv,
        uint256 amp,
        uint256 nn,
        uint256 p
    ) private pure returns (uint256 y) {
        //Round up p
        p = p.mul(inv).divUp(amp.mul(nn).mul(nn));
        //Round down b
        uint256 b = sum.add(inv.divDown(amp.mul(nn)));
        //Round up c
        uint256 c = inv >= b
            ? inv.sub(b).add(Math.sqrtUp(inv.sub(b).mul(inv.sub(b)).add(p.mul(4))))
            : Math.sqrtUp(b.sub(inv).mul(b.sub(inv)).add(p.mul(4))).sub(b.sub(inv));
        //Round up y
        y = c == 0 ? 0 : c.divUp(2);
    }
}
