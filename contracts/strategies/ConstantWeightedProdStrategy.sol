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
import "./lib/ConstantWeightedProduct.sol";

contract ConstantWeightedProdStrategy is
    IPairTradingStrategy,
    StrategyFee,
    ConstantWeightedProduct
{
    uint8 public constant MIN_TOKENS = 2;
    uint8 public constant MAX_TOKENS = 16;
    uint8 public constant MIN_WEIGHT = 1;

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

    uint256 private immutable _weight0;
    uint256 private immutable _weight1;
    uint256 private immutable _weight2;
    uint256 private immutable _weight3;
    uint256 private immutable _weight4;
    uint256 private immutable _weight5;
    uint256 private immutable _weight6;
    uint256 private immutable _weight7;
    uint256 private immutable _weight8;
    uint256 private immutable _weight9;
    uint256 private immutable _weight10;
    uint256 private immutable _weight11;
    uint256 private immutable _weight12;
    uint256 private immutable _weight13;
    uint256 private immutable _weight14;
    uint256 private immutable _weight15;

    constructor(
        address[] memory tokens,
        uint256[] memory weights,
        uint8 totalTokens,
        uint256 swapFee
    ) {
        require(swapFee >= MIN_FEE, "ERR_MIN_FEE");
        require(swapFee <= MAX_FEE, "ERR_MAX_FEE");
        _swapFee = swapFee;

        require(totalTokens >= MIN_TOKENS, "ERR_MIN_TOKENS");
        require(totalTokens <= MAX_TOKENS, "ERR_MAX_TOKENS");
        require(tokens.length == totalTokens, "ERR_TOKENS_LIST");
        require(weights.length == totalTokens, "ERR_WEIGHTS_LIST");
        for (uint8 i = 0; i < totalTokens; i++) {
            require(weights[i] >= MIN_WEIGHT, "ERR_MIN_WEIGHT");
        }
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
        _weight0 = totalTokens > 0 ? weights[0] : 0;
        _weight1 = totalTokens > 1 ? weights[1] : 0;
        _weight2 = totalTokens > 2 ? weights[2] : 0;
        _weight3 = totalTokens > 3 ? weights[3] : 0;
        _weight4 = totalTokens > 4 ? weights[4] : 0;
        _weight5 = totalTokens > 5 ? weights[5] : 0;
        _weight6 = totalTokens > 6 ? weights[6] : 0;
        _weight7 = totalTokens > 7 ? weights[7] : 0;
        _weight8 = totalTokens > 8 ? weights[8] : 0;
        _weight9 = totalTokens > 9 ? weights[9] : 0;
        _weight10 = totalTokens > 10 ? weights[10] : 0;
        _weight11 = totalTokens > 11 ? weights[11] : 0;
        _weight12 = totalTokens > 12 ? weights[12] : 0;
        _weight13 = totalTokens > 13 ? weights[13] : 0;
        _weight14 = totalTokens > 14 ? weights[14] : 0;
        _weight15 = totalTokens > 15 ? weights[15] : 0;
        _totalTokens = totalTokens;
    }

    function getTotalTokens() external view returns (uint8) {
        return _totalTokens;
    }

    function getWeight(address token) public view returns (uint256) {
        require(token != address(0), "ERR_INVALID_ADDRESS");
        if (token == _token0) {
            return _weight0;
        } else if (token == _token1) {
            return _weight1;
        } else if (token == _token2) {
            return _weight2;
        } else if (token == _token3) {
            return _weight3;
        } else if (token == _token4) {
            return _weight4;
        } else if (token == _token5) {
            return _weight5;
        } else if (token == _token6) {
            return _weight6;
        } else if (token == _token7) {
            return _weight7;
        } else if (token == _token8) {
            return _weight8;
        } else if (token == _token9) {
            return _weight9;
        } else if (token == _token10) {
            return _weight10;
        } else if (token == _token11) {
            return _weight11;
        } else if (token == _token12) {
            return _weight12;
        } else if (token == _token13) {
            return _weight13;
        } else if (token == _token14) {
            return _weight14;
        } else if (token == _token15) {
            return _weight15;
        } else {
            revert("ERR_INVALID_TOKEN");
        }
    }

    function validatePair(
        bytes32,
        address tokenIn,
        address tokenOut,
        uint256 balanceIn,
        uint256 balanceOut,
        uint256 amountIn,
        uint256 amountOut
    ) external override view returns (bool, uint256) {
        // Substract fee
        uint256 feeAmount = mul(amountIn, _swapFee);
        uint256 adjustedIn = sub(amountIn, feeAmount);

        // Calculate the maximum amount that can be taken out of the pool
        uint256 maximumAmountOut = _outGivenIn(
            balanceIn,
            getWeight(tokenIn),
            balanceOut,
            getWeight(tokenOut),
            adjustedIn
        );

        return (amountOut <= maximumAmountOut, feeAmount);
    }

    function getSwapFee() external override view returns (uint256) {
        return _swapFee;
    }
}
