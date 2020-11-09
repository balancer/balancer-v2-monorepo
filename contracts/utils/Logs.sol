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

contract Logs {
    event LogSwap(
        address indexed caller,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 tokenAmountIn,
        uint256 tokenAmountOut
    );

    event LogJoin(address indexed caller, address indexed tokenIn, uint256 tokenAmountIn);

    event LogExit(address indexed caller, address indexed tokenOut, uint256 tokenAmountOut);

    event LogCall(bytes4 indexed sig, address indexed caller, bytes data);

    modifier _logs_() {
        emit LogCall(msg.sig, msg.sender, msg.data);
        _;
    }
}
