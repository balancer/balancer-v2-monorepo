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

import "../strategies/lib/WeightedProduct.sol";

contract MockWeightedProdLib is WeightedProduct {
    function outGivenIn(
        uint128 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint128 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint128 tokenAmountIn
    ) external pure returns (uint128) {
        return _outGivenIn(tokenBalanceIn, tokenWeightIn, tokenBalanceOut, tokenWeightOut, tokenAmountIn);
    }

    function inGivenOut(
        uint128 tokenBalanceIn,
        uint256 tokenWeightIn,
        uint128 tokenBalanceOut,
        uint256 tokenWeightOut,
        uint128 tokenAmountOut
    ) external pure returns (uint128) {
        return _inGivenOut(tokenBalanceIn, tokenWeightIn, tokenBalanceOut, tokenWeightOut, tokenAmountOut);
    }
}
