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

pragma solidity ^0.7.0;

import "../pools/stable/StableMath.sol";

contract MockStableMath is StableMath {
    function invariant(uint256 amp, uint256[] calldata balances) external view returns (uint256) {
        return _calculateInvariant(amp, balances);
    }

    function outGivenIn(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountIn
    ) external view returns (uint256) {
        return _calcOutGivenIn(amp, balances, tokenIndexIn, tokenIndexOut, tokenAmountIn);
    }

    function inGivenOut(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountOut
    ) external view returns (uint256) {
        return _calcInGivenOut(amp, balances, tokenIndexIn, tokenIndexOut, tokenAmountOut);
    }

    function calculateDueTokenProtocolSwapFee(
        uint256 amp,
        uint256[] memory balances,
        uint256 lastInvariant,
        uint256 tokenIndex,
        uint256 protocolSwapFeePercentage
    ) external view returns (uint256) {
        return _calcDueTokenProtocolSwapFee(amp, balances, lastInvariant, tokenIndex, protocolSwapFeePercentage);
    }
}
