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

contract ConstantSumProdCurve is ICurve, FixedPoint {
    int256 internal constant CONST_0_3333333 = 333333333333333333;
    int256 internal constant CONST_0_5 = 500000000000000000;
    int256 internal constant CONST_1 = 1000000000000000000;

    //TODO: make amplification param inmutable with v0.7.1
    int256 internal constant amp = 100;

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
        int256 sum = 0;
        int256 prod = CONST_1;
        uint256 length = balances.length;
        for (uint256 i = 0; i < length; i++) {
            sum = sum + int256(balances[i]);
            prod = ((prod * int256(balances[i])) / CONST_1);
        }
        int256 n = int256(length);
        int256 nn = 1;
        for (uint256 i = 0; i < length; i++) {
            nn *= n;
        }
        //temp = nˆ2n * prod
        int256 temp = nn * nn * prod;
        int256 negative_q = (amp * temp * sum) / CONST_1;
        //P is positive is A > 1/(nˆn)
        int256 p = amp * temp - temp / nn;
        int256 c = LogExpMath.exp(
            p *
                (LogExpMath.exp(
                    (negative_q / (4 * p)) *
                        (negative_q / p) *
                        CONST_1 +
                        p /
                        27,
                    CONST_0_5
                ) / CONST_1) +
                negative_q /
                2,
            CONST_0_3333333
        );
        return uint256(c - (p * CONST_1) / (3 * c));
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
