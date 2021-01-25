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

import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../pools/stable/StableMath.sol";

contract MockStableMath is StableMath {
    using SafeCast for uint256;

    function outGivenIn(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountIn
    ) external pure returns (uint256) {
        return _outGivenIn(amp.toUint128(), balances, tokenIndexIn, tokenIndexOut, tokenAmountIn.toUint128());
    }

    function inGivenOut(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountOut
    ) external view returns (uint256) {
        return _inGivenOut(amp.toUint128(), balances, tokenIndexIn, tokenIndexOut, tokenAmountOut.toUint128());
    }
}
