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

import "./StrategyFee.sol";
import "./ITupleTradingStrategy.sol";
import "./lib/Stable.sol";

contract StableStrategy is ITupleTradingStrategy, StrategyFee, Stable {
    uint256 private immutable _amp;
    uint256 private immutable _swapFee;

    constructor(uint256 amp, uint256 swapFee) {
        require(swapFee >= MIN_FEE, "ERR_MIN_FEE");
        require(swapFee <= MAX_FEE, "ERR_MAX_FEE");
        _swapFee = swapFee;
        _amp = amp;
    }

    //Because it is not possible to overriding external calldata, function is public and balances are in memory
    function validateTuple(
        ITradingStrategy.Swap calldata swap,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public override view returns (bool, uint256) {
        //Calculate old invariant
        uint256 oldInvariant = _invariant(_amp, balances);

        //Substract fee
        uint256 feeAmount = mul(swap.amountIn, _swapFee);

        //Update Balances
        balances[indexIn] = add(
            balances[indexIn],
            sub(swap.amountIn, feeAmount)
        );
        balances[indexOut] = sub(balances[indexOut], swap.amountOut);

        //Calculate new invariant
        uint256 newInvariant = _invariant(_amp, balances);

        

        if (newInvariant >= oldInvariant) {
            return (true, feeAmount);
        } else {
            uint256 error = (newInvariant * 1000 / oldInvariant);
            return (error > 1 && error < 1000, feeAmount);
        }
    }

    function getAmp() external view returns (uint256) {
        return _amp;
    }

    function getSwapFee() external override view returns (uint256) {
        return _swapFee;
    }
}
