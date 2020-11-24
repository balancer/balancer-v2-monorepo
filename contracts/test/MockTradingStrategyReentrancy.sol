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
pragma experimental ABIEncoderV2;

import "../strategies/IPairTradingStrategy.sol";
import "../strategies/ITupleTradingStrategy.sol";

import "../math/FixedPoint.sol";

import "../vault/IVault.sol";

contract MockTradingStrategyReentrancy is IPairTradingStrategy {
    using FixedPoint for uint128;

    IVault public vault;

    constructor(IVault _vault) {
        vault = _vault;
    }

    // IPairTradingStrategy
    function quoteOutGivenIn(
        ITradingStrategy.QuoteRequestGivenIn calldata request,
        uint128,
        uint128
    ) external override returns (uint128, uint128) {
        //Reenter Vault
        IVault.SwapIn[] memory swaps = new IVault.SwapIn[](0);
        IERC20[] memory tokens = new IERC20[](0);
        vault.batchSwapGivenIn(
            swaps,
            tokens,
            IVault.FundManagement({
                sender: request.from,
                recipient: request.to,
                withdrawFromUserBalance: false,
                depositToUserBalance: false
            })
        );
        return (request.amountIn, 0);
    }

    function quoteInGivenOut(
        ITradingStrategy.QuoteRequestGivenOut calldata request,
        uint128,
        uint128
    ) external view override returns (uint128, uint128) {
        return (request.amountOut, 0);
    }
}
