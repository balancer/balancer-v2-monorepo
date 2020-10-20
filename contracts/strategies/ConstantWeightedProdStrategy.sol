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
import "./IPairTradingStrategy.sol";
import "../math/FixedPoint.sol";

import "@nomiclabs/buidler/console.sol";

contract ConstantWeightedProdStrategy is
    IPairTradingStrategy,
    StrategyFee,
    FixedPoint
{
    //TODO: cannot be immutable. Make one strategy for each total of tokens
    uint256[] private _weights;
    uint256 private immutable _swapFee;

    constructor(uint256[] memory weights, uint256 swapFee) {
        _weights = weights;
        _swapFee = swapFee;
    }

    function _calculateOutGivenIn(
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn
    ) internal view returns (uint256) {
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

    function validatePair(
        bytes32 poolId,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn,
        uint256 tokenAmountOut
    ) external override view returns (bool, uint256) {
        //Substract fee
        uint256 tokenAmountInMinusFee = div(tokenAmountIn, add(ONE, _swapFee));

        //Calculate out amount given in
        uint256 _tokenAmountOut = _calculateOutGivenIn(
            tokenIndexIn,
            tokenIndexOut,
            tokenBalanceIn,
            tokenBalanceOut,
            tokenAmountInMinusFee
        );

        return (_tokenAmountOut >= tokenAmountOut, _swapFee);
    }

    function getSwapFee() external override view returns (uint256) {
        return _swapFee;
    }
}
