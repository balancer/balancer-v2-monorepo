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

pragma solidity 0.7.1;
pragma experimental ABIEncoderV2;

import "../strategies/IPairTradingStrategy.sol";
import "../strategies/ITupleTradingStrategy.sol";

import "../math/FixedPoint.sol";

contract MockTradingStrategy is IPairTradingStrategy, ITupleTradingStrategy {
    using FixedPoint for uint128;

    // Amounts in are multiplied by the multiplier, amounts out divided by it
    uint128 private _multiplier = FixedPoint.ONE;
    uint128 private _fee = 0;

    function setMultiplier(uint128 newMultiplier) external {
        _multiplier = newMultiplier;
    }

    function setFee(uint128 newFee) external {
        _fee = newFee;
    }

    // IPairTradingStrategy
    function quoteOutGivenIn(
        ITradingStrategy.QuoteRequestGivenIn calldata request,
        uint128,
        uint128
    ) external view override returns (uint128, uint128) {
        return (request.amountIn.mul128(_multiplier), request.amountIn.mul128(_fee));
    }

    function quoteInGivenOut(
        ITradingStrategy.QuoteRequestGivenOut calldata request,
        uint128,
        uint128
    ) external view override returns (uint128, uint128) {
        uint128 amountIn = request.amountOut.div128(_multiplier);
        return (amountIn, amountIn.mul128(_fee));
    }

    // ITupleTradingStrategy
    function quoteOutGivenIn(
        ITradingStrategy.QuoteRequestGivenIn calldata request,
        uint128[] calldata,
        uint256,
        uint256
    ) external view override returns (uint128, uint128) {
        return (request.amountIn.mul128(_multiplier), request.amountIn.mul128(_fee));
    }

    function quoteInGivenOut(
        ITradingStrategy.QuoteRequestGivenOut calldata request,
        uint128[] calldata,
        uint256,
        uint256
    ) external view override returns (uint128, uint128) {
        uint128 amountIn = request.amountOut.div128(_multiplier);
        return (amountIn, amountIn.mul128(_fee));
    }
}
