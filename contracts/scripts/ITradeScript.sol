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

pragma experimental ABIEncoderV2;

pragma solidity ^0.7.1;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../math/FixedPoint.sol";

import "../vault/IVault.sol";

interface ITradeScript {
    struct OverallInfoIn {
        IERC20 overallTokenIn;
        IERC20 overallTokenOut;
        uint128 maxAmountIn;
        uint128 minAmountOut;
    }

    function swapExactAmountIn(
        OverallInfoIn memory info,
        IVault.SwapIn[] memory swaps,
        IERC20[] memory tokens,
        bool withdrawTokens
    ) external;
}
