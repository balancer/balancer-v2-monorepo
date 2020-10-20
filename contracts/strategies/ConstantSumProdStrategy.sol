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

import "./StrategyFee.sol";
import "./ITupleTradingStrategy.sol";
import "../math/FixedPoint.sol";
import "../LogExpMath.sol";

contract ConstantSumProdStrategy is
    ITupleTradingStrategy,
    StrategyFee,
    FixedPoint
{
    uint256 private immutable _amp;
    uint256 private immutable _swapFee;

    constructor(uint256 amp, uint256 swapFee) {
        require(swapFee >= MIN_FEE, "ERR_MIN_FEE");
        require(swapFee <= MAX_FEE, "ERR_MAX_FEE");
        _swapFee = swapFee;
        _amp = amp;
    }

    function _calculateInvariant(uint256[] memory balances)
        internal
        view
        returns (uint256)
    {
        uint256 S = 0;
        uint256 N_COINS = balances.length;
        for (uint256 i = 0; i < N_COINS; i++) {
            S = S + balances[i];
        }
        if (S == 0) {
            return 0;
        }
        uint256 Dprev = 0;
        uint256 D = S;
        uint256 Ann = _amp * N_COINS;
        //TODO: make calculations to test and document this approximation. Compare it with math approx.
        for (uint256 i = 0; i < 255; i++) {
            uint256 D_P = D;
            for (uint256 j = 0; j < N_COINS; j++) {
                D_P = (D_P * D) / (balances[j] * N_COINS);
            }
            Dprev = D;
            D =
                ((Ann * S + D_P * N_COINS) * D) /
                ((Ann - 1) * D + (N_COINS + 1) * D_P);
            // Equality with the precision of 1
            if (D > Dprev) {
                if ((D - Dprev) <= 1) {
                    break;
                }
            } else if ((Dprev - D) <= 1) {
                break;
            }
        }
        return D;
    }

    function validateTuple(
        bytes32 poolId,
        uint256 tokenIndexIn,
        uint256 tokenAmountIn,
        uint256[] memory oldBalances,
        uint256[] memory newBalances
    ) public override view returns (bool, uint256) {
        //Substract fee
        oldBalances[tokenIndexIn] = sub(
            oldBalances[tokenIndexIn],
            div(mul(tokenAmountIn, _swapFee), add(ONE, _swapFee))
        );

        //Calculate old invariant
        uint256 oldInvariant = _calculateInvariant(oldBalances);

        //Calculate new invariant
        uint256 newInvariant = _calculateInvariant(newBalances);

        return (newInvariant >= oldInvariant, _swapFee);
    }

    function getSwapFee() external override view returns (uint256) {
        return _swapFee;
    }
}
