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

import "hardhat/console.sol";

import "./ITradeScript.sol";

contract TradeScript is ITradeScript {
    using SafeCast for uint256;
    using SafeCast for int256;
    using FixedPoint for uint256;
    using FixedPoint for int256;
    using FixedPoint for uint128;

    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    function swapExactAmountIn(
        OverallInfoIn memory info,
        IVault.SwapIn[] memory swaps,
        IERC20[] memory tokens,
        bool withdrawTokens
    ) public override {
        int256[] memory vaultDeltas = _vault.batchSwapGivenIn(
            swaps,
            tokens,
            IVault.FundManagement({
                sender: msg.sender,
                recipient: msg.sender,
                withdrawFromUserBalance: false,
                depositToUserBalance: !withdrawTokens
            })
        );

        for (uint256 i = 0; i < tokens.length; ++i) {
            if (tokens[i] == info.overallTokenIn) {
                require(vaultDeltas[i] <= info.maxAmountIn, "Excessive amount in");
            } else if (tokens[i] == info.overallTokenOut) {
                require(vaultDeltas[i].abs() >= info.minAmountOut, "Not enough tokens out");
            } else {
                require(vaultDeltas[i] == 0, "Intermediate non-zero balance");
            }
        }
    }
}
