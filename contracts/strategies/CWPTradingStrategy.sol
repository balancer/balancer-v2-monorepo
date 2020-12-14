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

import "hardhat/console.sol";

import "./IPairTradingStrategy.sol";
import "./lib/WeightedProduct.sol";
import "./settings/SwapFeeStrategySetting.sol";
import "./settings/WeightsStrategySetting.sol";
import "./IAccSwapFeeStrategy.sol";

// This contract relies on tons of immutable state variables to
// perform efficient lookup, without resorting to storage reads.

contract CWPTradingStrategy is
    IPairTradingStrategy,
    WeightedProduct,
    SwapFeeStrategySetting,
    WeightsStrategySetting,
    IAccSwapFeeStrategy
{
    constructor(TokenWeights memory tokenWeights, SwapFee memory swapFee)
        WeightsStrategySetting(tokenWeights)
        SwapFeeStrategySetting(swapFee)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function quoteOutGivenIn(
        QuoteRequestGivenIn calldata request,
        uint128 currentBalanceTokenIn,
        uint128 currentBalanceTokenOut
    ) external view override returns (uint128) {
        uint128 adjustedIn = _subtractSwapFee(request.amountIn);

        // Calculate the maximum amount that can be taken out of the pool
        uint128 maximumAmountOut = _outGivenIn(
            currentBalanceTokenIn,
            _weight(request.tokenIn),
            currentBalanceTokenOut,
            _weight(request.tokenOut),
            adjustedIn
        );

        return maximumAmountOut;
    }

    function quoteInGivenOut(
        QuoteRequestGivenOut calldata request,
        uint128 currentBalanceTokenIn,
        uint128 currentBalanceTokenOut
    ) external view override returns (uint128) {
        // Calculate the minimum amount that must be put into the pool
        uint128 minimumAmountIn = _inGivenOut(
            currentBalanceTokenIn,
            _weight(request.tokenIn),
            currentBalanceTokenOut,
            _weight(request.tokenOut),
            request.amountOut
        );

        return _addSwapFee(minimumAmountIn);
    }

    function getAccSwapFees(uint128[] memory balances) external view override returns (uint128[] memory) {
        uint256 totalTokens = getTotalTokens();
        require(balances.length == totalTokens, "ERR_INVALID_BALANCES_LENGTH");
        uint128[] memory swapFeesCollected = new uint128[](totalTokens);
        //TODO: calculate swap fee and pick random token
        return swapFeesCollected;
    }

    function resetAccSwapFees(uint128[] calldata balances) external override {
        //TODO: reset swap fees
    }
}
