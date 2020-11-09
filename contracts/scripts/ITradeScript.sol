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
    // Used to store data in memory and avoid stack-too-deep errors
    struct OverallInfoIn {
        IERC20 overallTokenIn;
        IERC20 overallTokenOut;
        uint128 minAmountOut;
        uint128 maxPrice;
    }

    // Used to store data in memory and avoid stack-too-deep errors
    struct OverallInfoOut {
        IERC20 overallTokenIn;
        IERC20 overallTokenOut;
        uint128 maxAmountIn;
        uint128 maxPrice;
    }

    // Used to store data in memory and avoid stack-too-deep errors
    struct Helper {
        uint128 toSend;
        uint128 toReceive;
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint128 amountUsedToCalculate;
        uint128 amountCalculated;
    }

    struct SwapTokenIndexes {
        uint256 tokenIndexIn;
        uint256 tokenIndexOut;
    }

    function swapExactAmountIn(
        OverallInfoIn memory info,
        IVault.Diff[] memory diffs,
        IVault.Swap[] memory swaps,
        SwapTokenIndexes[] memory indexes,
        uint128[] memory amountsIn,
        bool withdrawTokens
    ) external;

    function swapExactAmountOut(
        OverallInfoOut memory info,
        IVault.Diff[] memory diffs,
        IVault.Swap[] memory swaps,
        SwapTokenIndexes[] memory indexes,
        uint128[] memory amountsOut,
        bool withdrawTokens
    ) external;
}
