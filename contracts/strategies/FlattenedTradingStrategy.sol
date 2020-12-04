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

import "./ITupleTradingStrategy.sol";
import "./lib/Stable.sol";
import "./settings/AmpStrategySetting.sol";
import "./settings/SwapFeeStrategySetting.sol";

contract FlattenedTradingStrategy is ITupleTradingStrategy, Stable, AmpStrategySetting, SwapFeeStrategySetting {
    constructor(Amp memory amp, SwapFee memory swapFee) AmpStrategySetting(amp) SwapFeeStrategySetting(swapFee) {
        // solhint-disable-previous-line no-empty-blocks
    }

    // Because it is not possible to overriding external calldata, function is public and balances are in memory
    function quoteOutGivenIn(
        QuoteRequestGivenIn calldata request,
        uint128[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint128) {
        uint128 adjustedIn = _subtractSwapFee(request.amountIn);
        uint128 maximumAmountOut = _outGivenIn(_amp(), balances, indexIn, indexOut, adjustedIn);
        return maximumAmountOut;
    }

    function quoteInGivenOut(
        QuoteRequestGivenOut calldata request,
        uint128[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint128) {
        uint128 minimumAmountIn = _inGivenOut(_amp(), balances, indexIn, indexOut, request.amountOut);
        return _addSwapFee(minimumAmountIn);
    }
}
