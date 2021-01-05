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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITradingStrategy {
    // TODO: outdated docs, fix
    // This data structure represents a two tokens swap and is used by strategies for trade validation.
    // `from` is the origin address where the entering funds are coming from
    // `to` is the destination address where exiting funds are going to.
    // `tokenIn` and 'tokenOut' are the token increasing in funds and the token decreasing respectively.
    // `amountIn` and `amountOut` are the amount increased by `tokenIn`
    // and the amount decreased by `tokenOut`respectively.
    // `userData` is any extra data that the swap caller wants to send to the strategy to validate the swap.
    struct QuoteRequestGivenIn {
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint256 amountIn;
        // Misc data
        bytes32 poolId;
        address from;
        address to;
        bytes userData;
    }

    struct QuoteRequestGivenOut {
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint256 amountOut;
        // Misc data
        bytes32 poolId;
        address from;
        address to;
        bytes userData;
    }
}
