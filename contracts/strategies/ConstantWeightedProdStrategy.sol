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

import "./IStrategy.sol";
import "../math/FixedPoint.sol";
import "../LogExpMath.sol";

contract ConstantWeightedProdStrategy is IStrategy, FixedPoint {
    //TODO: cannot be immutable. Make one strategy for each total of tokens
    uint256[] public weights;

    constructor(uint256[] memory _weights) {
        weights = _weights;
    }

    function hasPairValidation() external override pure returns (bool) {
        return true;
    }

    function calculateOutGivenIn(
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
            weights[tokenIndexIn],
            weights[tokenIndexOut]
        );

        uint256 ratio = sub(ONE, pow(quotient, weightRatio));

        return mul(tokenBalanceOut, ratio);
    }

    function calculateInvariant(uint256[] memory balances)
        internal
        view
        returns (uint256 invariant)
    {
        uint256 length = weights.length;
        require(balances.length == length, "ERR_INVALID_BALANCES");
        invariant = ONE;
        for (uint8 i = 0; i < length; i++) {
            require(balances[i] > 0, "ERR_INVALID_BALANCE"); //Balance should never be zero
            invariant = mul(
                invariant,
                uint256(LogExpMath.exp(int256(balances[i]), int256(weights[i])))
            );
        }
    }

    function validatePair(
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenBalanceIn,
        uint256 tokenBalanceOut,
        uint256 tokenAmountIn,
        uint256 tokenAmountOut
    ) external override view returns (bool) {
        //Calculate out amount given in
        uint256 _tokenAmountOut = calculateOutGivenIn(
            tokenIndexIn,
            tokenIndexOut,
            tokenBalanceIn,
            tokenBalanceOut,
            tokenAmountIn
        );

        return _tokenAmountOut >= tokenAmountOut;
    }

    function validateAll(
        uint256[] calldata oldBalances,
        uint256[] calldata newBalances
    ) external override view returns (bool) {
        //Calculate old invariant
        uint256 oldInvariant = calculateInvariant(oldBalances);

        //Calculate new invariant
        uint256 newInvariant = calculateInvariant(newBalances);

        return newInvariant >= oldInvariant;
    }
}
