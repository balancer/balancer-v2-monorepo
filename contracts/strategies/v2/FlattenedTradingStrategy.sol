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

import "@openzeppelin/contracts/utils/SafeCast.sol";

import "./ITupleTradingStrategy.sol";
import "../StrategyFee.sol";
import "../lib/Stable.sol";

contract FlattenedTradingStrategy is ITupleTradingStrategy, StrategyFee, Stable {
    using SafeCast for uint256;
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    uint128 private immutable _amp;
    uint256 private immutable _swapFee;

    constructor(uint128 amp, uint256 swapFee) {
        require(swapFee >= MIN_FEE, "ERR_MIN_FEE");
        require(swapFee <= MAX_FEE, "ERR_MAX_FEE");
        _swapFee = swapFee;
        _amp = amp;
    }

    //Because it is not possible to overriding external calldata, function is public and balances are in memory
    function quoteOutGivenIn(
        ITradingStrategy.QuoteRequestGivenIn calldata request,
        uint128[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint128, uint128) {
        //Substract fee
        uint128 feeAmount = request.amountIn.mul(_swapFee).toUint128();
        uint128 adjustedIn = request.amountIn.sub128(feeAmount);

        uint128 amountOut = _outGivenIn(_amp, balances, indexIn, indexOut, adjustedIn);

        return (amountOut, feeAmount);
    }

    function getAmp() external view returns (uint128) {
        return _amp;
    }

    function getSwapFee() external view override returns (uint256) {
        return _swapFee;
    }
}
