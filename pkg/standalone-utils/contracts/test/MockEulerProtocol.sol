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

pragma solidity ^0.7.0;

import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

contract MockEulerProtocol is TestToken {
    using SafeERC20 for IERC20;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals
    ) 
    TestToken(name, symbol, decimals) {

    }

    function approveWithdrawl(address underlying, address eToken) public {
        // eToken is allowed to spend maximum amount of underlying from this contract.
        IERC20(underlying).approve(eToken, 2**256 - 1);
    }

    function requestUnderlyingFromRelayer(address underlying, uint256 amount, address relayer) public {
        IERC20(underlying).transferFrom(relayer, (address(this)), amount);
    }

    function sendUnderlyingToRelayer(address underlying, uint256 amount, address relayer) public {
        IERC20(underlying).transfer(relayer, amount);
    }
}