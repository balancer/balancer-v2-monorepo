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
import "../strategies/StrategyFee.sol";

import "../math/FixedPoint.sol";

contract MockTradingStrategy is IPairTradingStrategy, ITupleTradingStrategy, StrategyFee {
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    // Amounts in are multiplied by the multiplier, amounts out divided by it
    uint128 private _multiplier = FixedPoint.ONE;

    uint128[] private _swapFeesCollected;

    function setMultiplier(uint128 newMultiplier) external {
        _multiplier = newMultiplier;
    }

    function setAccSwapFees(uint128[] memory swapFeesCollected) external {
        _swapFeesCollected = swapFeesCollected;
    }

    // IPairTradingStrategy
    function quoteOutGivenIn(
        ITradingStrategy.QuoteRequestGivenIn calldata request,
        uint128,
        uint128
    ) external view override returns (uint128) {
        return request.amountIn.mul128(_multiplier);
    }

    function quoteInGivenOut(
        ITradingStrategy.QuoteRequestGivenOut calldata request,
        uint128,
        uint128
    ) external view override returns (uint128) {
        uint128 amountIn = request.amountOut.div128(_multiplier);
        return amountIn;
    }

    // ITupleTradingStrategy
    function quoteOutGivenIn(
        ITradingStrategy.QuoteRequestGivenIn calldata request,
        uint128[] calldata,
        uint256,
        uint256
    ) external view override returns (uint128) {
        return request.amountIn.mul128(_multiplier);
    }

    function quoteInGivenOut(
        ITradingStrategy.QuoteRequestGivenOut calldata request,
        uint128[] calldata,
        uint256,
        uint256
    ) external view override returns (uint128) {
        uint128 amountIn = request.amountOut.div128(_multiplier);
        return amountIn;
    }

    function calculateAccSwapFees(uint128[] memory) external view override returns (uint128[] memory) {
        return _swapFeesCollected;
    }

    function resetAccSwapFees(uint128[] calldata) external override {
        for (uint256 i = 0; i < _swapFeesCollected.length; i++) {
            _swapFeesCollected[i] = 0;
        }
    }

    //Not used function
    function getSwapFee() external pure override returns (uint256) {
        return 0;
    }
}
