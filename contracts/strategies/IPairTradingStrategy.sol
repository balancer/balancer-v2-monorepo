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

import "./ITradingStrategy.sol";

interface IPairTradingStrategy {
    /**
     * @dev Validates a change in balances of Pair Trading Strategy. This strategy needs
     * only the two balances changed to perform the validation.
     * The change to validate is `balanceIn` of `swap.tokenIn` token increased by `swap.amountIn`
     * and `balanceOut` of `swap.tokenOut` decreased by `swap.amountOut`
     */
    function validatePair(
        ITradingStrategy.Swap calldata swap,
        uint128 balanceIn,
        uint128 balanceOut
    ) external returns (bool, uint128);
}
