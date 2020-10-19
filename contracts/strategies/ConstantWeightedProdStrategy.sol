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

import "./IPairTradingStrategy.sol";
import "../math/FixedPoint.sol";

contract ConstantWeightedProdStrategy is IPairTradingStrategy, FixedPoint {
    uint8 public constant MIN_TOKENS = 2;
    uint8 public constant MAX_TOKENS = 16;
    uint8 public constant MIN_WEIGHT = 1;
    uint256 public constant DECIMALS = 10**16; // 16 decimal places

    uint256 private immutable _weights; // 16 16-byte weights packed together. index 0 is LSB and index 15 is MSB
    uint8 private immutable _totalTokens;

    constructor(uint256 weights, uint8 totalTokens) {
        require(totalTokens >= MIN_TOKENS, "ERR_MIN_TOKENS");
        require(totalTokens <= MAX_TOKENS, "ERR_MAX_TOKENS");
        for (uint8 index = 0; index < totalTokens; index++) {
            require(
                _shiftWeights(weights, index) >= MIN_WEIGHT,
                "ERR_MIN_WEIGHT"
            );
        }
        _weights = weights;
        _totalTokens = totalTokens;
    }

    function getTotalTokens() external view returns (uint8) {
        return _totalTokens;
    }

    function _shiftWeights(uint256 weights, uint8 index)
        internal
        pure
        returns (uint256)
    {
        uint8 shift = index * 16;
        return ((weights & (0xFFFF << shift)) >> shift);
    }

    function getWeight(uint8 index) public view returns (uint256) {
        require(index < _totalTokens, "ERR_INVALID_INDEX");
        return _shiftWeights(_weights, index) * DECIMALS;
    }

    function _calculateOutGivenIn(
        uint8 tokenIndexIn,
        uint8 tokenIndexOut,
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn
    ) internal view returns (uint256) {
        uint256 quotient = div(
            tokenBalanceIn,
            add(tokenBalanceIn, tokenAmountIn)
        );

        uint256 weightRatio = div(
            getWeight(tokenIndexIn),
            getWeight(tokenIndexOut)
        );
        uint256 ratio = sub(ONE, pow(quotient, weightRatio));
        return mul(tokenBalanceOut, ratio);
    }

    function validatePair(
        bytes32 poolId,
        uint8 tokenIndexIn,
        uint8 tokenIndexOut,
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn,
        uint256 tokenAmountOut
    ) external override view returns (bool) {
        //Calculate out amount given in
        uint256 _tokenAmountOut = _calculateOutGivenIn(
            tokenIndexIn,
            tokenIndexOut,
            tokenBalanceIn,
            tokenBalanceOut,
            tokenAmountIn
        );

        return _tokenAmountOut >= tokenAmountOut;
    }
}
