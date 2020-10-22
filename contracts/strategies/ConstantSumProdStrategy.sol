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
import "./lib/ConstantSumProduct.sol";
import "../LogExpMath.sol";

contract ConstantSumProdStrategy is
    ITupleTradingStrategy,
    StrategyFee,
    ConstantSumProduct
{
    uint8 public constant MIN_TOKENS = 2;
    uint8 public constant MAX_TOKENS = 16;

    uint256 private immutable _amp;
    uint256 private immutable _swapFee;
    uint8 private immutable _totalTokens;

    address private immutable _token0;
    address private immutable _token1;
    address private immutable _token2;
    address private immutable _token3;
    address private immutable _token4;
    address private immutable _token5;
    address private immutable _token6;
    address private immutable _token7;
    address private immutable _token8;
    address private immutable _token9;
    address private immutable _token10;
    address private immutable _token11;
    address private immutable _token12;
    address private immutable _token13;
    address private immutable _token14;
    address private immutable _token15;

    constructor(
        address[] memory tokens,
        uint8 totalTokens,
        uint256 amp,
        uint256 swapFee
    ) {
        require(swapFee >= MIN_FEE, "ERR_MIN_FEE");
        require(swapFee <= MAX_FEE, "ERR_MAX_FEE");
        _swapFee = swapFee;
        _amp = amp;

        require(totalTokens >= MIN_TOKENS, "ERR_MIN_TOKENS");
        require(totalTokens <= MAX_TOKENS, "ERR_MAX_TOKENS");
        require(tokens.length == totalTokens, "ERR_TOKENS_LIST");
        //This is because immutable variables cannot be initialized inside an if statement or on another function.
        _token0 = totalTokens > 0 ? tokens[0] : address(0);
        _token1 = totalTokens > 1 ? tokens[1] : address(0);
        _token2 = totalTokens > 2 ? tokens[2] : address(0);
        _token3 = totalTokens > 3 ? tokens[3] : address(0);
        _token4 = totalTokens > 4 ? tokens[4] : address(0);
        _token5 = totalTokens > 5 ? tokens[5] : address(0);
        _token6 = totalTokens > 6 ? tokens[6] : address(0);
        _token7 = totalTokens > 7 ? tokens[7] : address(0);
        _token8 = totalTokens > 8 ? tokens[8] : address(0);
        _token9 = totalTokens > 9 ? tokens[9] : address(0);
        _token10 = totalTokens > 10 ? tokens[10] : address(0);
        _token11 = totalTokens > 11 ? tokens[11] : address(0);
        _token12 = totalTokens > 12 ? tokens[12] : address(0);
        _token13 = totalTokens > 13 ? tokens[13] : address(0);
        _token14 = totalTokens > 14 ? tokens[14] : address(0);
        _token15 = totalTokens > 15 ? tokens[15] : address(0);
        _totalTokens = totalTokens;
    }

    function getIndex(address token) public view returns (uint8) {
        require(token != address(0), "ERR_INVALID_ADDRESS");
        if (token == _token0) {
            return 0;
        } else if (token == _token1) {
            return 1;
        } else if (token == _token2) {
            return 2;
        } else if (token == _token3) {
            return 3;
        } else if (token == _token4) {
            return 4;
        } else if (token == _token5) {
            return 5;
        } else if (token == _token6) {
            return 6;
        } else if (token == _token7) {
            return 7;
        } else if (token == _token8) {
            return 8;
        } else if (token == _token9) {
            return 9;
        } else if (token == _token10) {
            return 10;
        } else if (token == _token11) {
            return 11;
        } else if (token == _token12) {
            return 12;
        } else if (token == _token13) {
            return 13;
        } else if (token == _token14) {
            return 14;
        } else if (token == _token15) {
            return 15;
        } else {
            revert("ERR_INVALID_TOKEN");
        }
    }

    //Because it is not possible to overriding external calldata, function is public and balances are in memory
    function validateTuple(
        bytes32,
        address tokenIn,
        address tokenOut,
        uint256[] memory balances,
        uint256 tokenAmountIn,
        uint256 tokenAmountOut
    ) public override view returns (bool, uint256) {
        //Calculate old invariant
        uint256 oldInvariant = calculateInvariant(_amp, balances);

        //Substract fee
        uint256 feeAmount = mul(tokenAmountIn, _swapFee);

        //Update Balances
        uint8 indexIn = getIndex(tokenIn);
        balances[indexIn] = add(
            balances[indexIn],
            sub(tokenAmountIn, feeAmount)
        );
        uint8 indexOut = getIndex(tokenOut);
        balances[indexOut] = sub(balances[indexOut], tokenAmountOut);

        //Calculate new invariant
        uint256 newInvariant = calculateInvariant(_amp, balances);

        return (newInvariant >= oldInvariant, feeAmount);
    }

    function getSwapFee() external override view returns (uint256) {
        return _swapFee;
    }
}
