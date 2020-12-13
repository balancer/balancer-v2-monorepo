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

import "../strategies/lib/Stable.sol";

contract MockStableLib is Stable {
    function outGivenIn(
        uint128 amp,
        uint128[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint128 tokenAmountIn
    ) external pure returns (uint128) {
        return _outGivenIn(amp, balances, tokenIndexIn, tokenIndexOut, tokenAmountIn);
    }

    function inGivenOut(
        uint128 amp,
        uint128[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint128 tokenAmountOut
    ) external pure returns (uint128) {
        return _inGivenOut(amp, balances, tokenIndexIn, tokenIndexOut, tokenAmountOut);
    }

    function invariant(uint128 amp, uint128[] memory balances) external pure returns (int256) {
        return _invariant(amp, balances);
    }
}
