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
import "./StrategyFee.sol";


contract FlattenedTradingStrategy is ITupleTradingStrategy, StrategyFee, Stable {
    uint128 private _mutableAmp;
    uint128 private immutable _immutableAmp;
    bool private immutable _isAmpMutable;

    uint256 private _mutableSwapFee;
    uint256 private immutable _immutableSwapFee;
    bool private immutable _isSwapFeeMutable;

    event AmpSet(uint128 amp);
    event SwapFeeSet(uint256 swapFee);

    constructor(bool isAmpMutable, uint128 amp, bool isSwapFeeMutable, uint256 swapFee) {
        require(swapFee >= MIN_FEE, "ERR_MIN_FEE");
        require(swapFee <= MAX_FEE, "ERR_MAX_FEE");

        _isAmpMutable = isAmpMutable;
        _immutableAmp = isAmpMutable ? 0 : amp;
        _mutableAmp = isAmpMutable ? amp : 0;

        _isSwapFeeMutable = isSwapFeeMutable;
        _immutableSwapFee = isSwapFeeMutable ? 0 : swapFee;
        _mutableSwapFee = isSwapFeeMutable ? swapFee : 0;
    }

    function setAmp(uint128 newAmp) external {
        // TODO: auth
        require(_isAmpMutable, "Amp is not mutable");
        _setAmp(newAmp);
    }

    function setSwapFee(uint256 newSwapFee) external {
        // TODO: auth
        require(_isSwapFeeMutable, "Swap fee is not mutable");
        _setSwapFee(newSwapFee);
    }

    //Because it is not possible to overriding external calldata, function is public and balances are in memory
    function quoteOutGivenIn(
        QuoteRequestGivenIn calldata request,
        uint128[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint128) {
        uint128 adjustedIn = _subtractFee(request.amountIn);

        uint128 maximumAmountOut = _outGivenIn(getAmp(), balances, indexIn, indexOut, adjustedIn);

        return maximumAmountOut;
    }

    function quoteInGivenOut(
        QuoteRequestGivenOut calldata request,
        uint128[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint128) {
        uint128 minimumAmountIn = _inGivenOut(getAmp(), balances, indexIn, indexOut, request.amountOut);
        return _addFee(minimumAmountIn);
    }

    function _setAmp(uint128 newAmp) internal {
        _mutableAmp = newAmp;
        emit AmpSet(newAmp);
    }

    function _setSwapFee(uint256 swapFee) internal {
        _mutableSwapFee = swapFee;
        emit SwapFeeSet(swapFee);
    }

    function getAmp() public view returns (uint128) {
        return _isAmpMutable ? _mutableAmp : _immutableAmp;
    }

    function _getSwapFee() internal view override returns (uint256) {
        return _isSwapFeeMutable ? _mutableSwapFee : _immutableSwapFee;
    }
}
