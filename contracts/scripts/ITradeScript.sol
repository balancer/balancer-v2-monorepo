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
        address overallTokenIn;
        address overallTokenOut;
        uint128 minAmountOut;
        uint256 maxPrice;
    }

    // Used to store data in memory and avoid stack-too-deep errors
    struct OverallInfoOut {
        address overallTokenIn;
        address overallTokenOut;
        uint128 maxAmountIn;
        uint256 maxPrice;
    }

    // Used to store data in memory and avoid stack-too-deep errors
    struct Helper {
        uint256 toSend;
        uint256 toReceive;
        address tokenIn;
        address tokenOut;
        uint128 amountFrom;
        uint128 amountTo;
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
