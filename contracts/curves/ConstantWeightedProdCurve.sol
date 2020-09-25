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

pragma solidity 0.7.1;

import "./ICurve.sol";
import "../math/FixedPoint.sol";
import "../LogExpMath.sol";
//import "@nomiclabs/buidler/console.sol";

contract ConstantWeightedProdCurve is ICurve, FixedPoint {
    uint256[] private _weights;

    constructor(uint256[] memory weights) public {
        _weights = weights;
    }

    function spotPrice(
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 swapFee
    ) external override view returns (uint256) {
        /**********************************************************************************************
        // spotPrice                                                                                 //
        // sP = spotPrice                                                                            //
        // bI = tokenBalanceIn                ( bI / wI )         1                                  //
        // bO = tokenBalanceOut         sP =  -----------  *  ----------                             //
        // wI = tokenWeightIn                 ( bO / wO )     ( 1 - sF )                             //
        // wO = tokenWeightOut                                                                       //
        // sF = swapFee                                                                              //
        **********************************************************************************************/
       uint256 tokenWeightIn = _weights[tokenIndexIn];
       uint256 tokenWeightOut = _weights[tokenIndexOut];

        uint256 numerator = div(tokenBalanceIn, tokenWeightIn);
        uint256 denominator = div(tokenBalanceOut, tokenWeightOut);

        uint256 spotPriceSansFee = div(numerator, denominator);

        uint256 feeFactor = div(ONE, sub(ONE, swapFee));

        return mul(spotPriceSansFee, feeFactor);
    }

    function getWeight(uint8 index) public view returns (uint256) {
        return _weights[index];
    }

    function calculateOutGivenIn(
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn
    ) public view override returns (uint256) {
        uint256 quotient = div(
            tokenBalanceIn,
            add(tokenBalanceIn, tokenAmountIn)
        );
        uint256 weightRatio = div(
            _weights[tokenIndexIn],
            _weights[tokenIndexOut]
        );

        uint256 ratio = sub(ONE, pow(quotient, weightRatio));

        return mul(tokenBalanceOut, ratio);
    }

    function calculateInvariant(uint256[] memory balances)
        public
        override
        returns (uint256 invariant)
    {
        uint256 length = _weights.length;
        require(balances.length == length, "ERR_INVALID_BALANCES");
        invariant = ONE;
        for (uint8 i = 0; i < length; i++) {
            require(balances[i] > 0, "ERR_INVALID_BALANCE"); //Balance should never be zero
            invariant = mul(
                invariant,
                uint256(
                    LogExpMath.exp(int256(balances[i]), int256(_weights[i]))
                )
            );
        }
    }

    function validateOutGivenIn(
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn,
        uint256 tokenAmountOut
    ) external override returns (bool) {
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
    ) external override returns (bool) {
        //Calculate old invariant
        uint256 oldInvariant = calculateInvariant(oldBalances);

        //Calculate new invariant
        uint256 newInvariant = calculateInvariant(newBalances);

        if (newInvariant > oldInvariant) {
            return sub(ONE, div(oldInvariant, newInvariant)) < 1876900;
        } else {
            return sub(ONE, div(newInvariant, oldInvariant)) < 1876900;
        }
    }
}
