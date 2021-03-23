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

import "../vault/balances/InternalBalanceAllocation.sol";

contract InternalBalanceAllocationMock {
    using InternalBalanceAllocation for bytes32;

    function actual(bytes32 balance) public pure returns (uint256) {
        return balance.actual();
    }

    function exempt(bytes32 balance) public pure returns (uint256) {
        return balance.exempt();
    }

    function blockNumber(bytes32 balance) public pure returns (uint256) {
        return balance.blockNumber();
    }

    function increase(bytes32 balance, uint256 amount, bool trackExempt) public view returns (bytes32) {
        return balance.increase(amount, trackExempt);
    }

    function decrease(bytes32 balance, uint256 amount, bool capped, bool useExempt) public view returns (bytes32 newBalance, uint256 taxableAmount, uint256 decreasedAmount) {
        return balance.decrease(amount, capped, useExempt);
    }

    function toInternalBalance(uint256 _actual, uint256 _exempt, uint256 _blockNumber) public pure returns (bytes32) {
        return InternalBalanceAllocation.toInternalBalance(_actual, _exempt, _blockNumber);
    }
}
