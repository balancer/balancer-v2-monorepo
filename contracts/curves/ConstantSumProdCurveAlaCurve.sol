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

pragma solidity 0.5.12;

import "./ICurve.sol";
import "../math/FixedPoint.sol";
import "../LogExpMath.sol";

contract ConstantSumProdCurveAlaCurve is ICurve, FixedPoint {
    //TODO: make amplification param inmutable with v0.7.1
    uint256 internal constant amp = 100;

    function calculateOutGivenIn(
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn
    ) public returns (uint256) {
        //TODO: implement out given in for this invariant
        revert("Not implemented yet");
    }

    function calculateInvariant(uint256[] memory balances)
        public
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
        uint256 Ann = amp * N_COINS;
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

    function validateOutGivenIn(
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn,
        uint256 tokenAmountOut
    ) external returns (bool) {
        //Calculate out amount out
        uint256 _tokenAmountOut = calculateOutGivenIn(
            tokenIndexIn,
            tokenIndexOut,
            tokenBalanceIn,
            tokenBalanceOut,
            tokenAmountIn
        );

        return _tokenAmountOut >= tokenAmountOut;
    }

    function validateBalances(
        uint256[] calldata oldBalances,
        uint256[] calldata newBalances
    ) external returns (bool) {
        //Calculate old invariant
        uint256 oldInvariant = calculateInvariant(oldBalances);

        //Calculate new invariant
        uint256 newInvariant = calculateInvariant(newBalances);

        return newInvariant >= oldInvariant;
    }
}
