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

import "../balances/BalanceAllocation.sol";

contract BalanceAllocationMock {
    using BalanceAllocation for bytes32;

    function total(bytes32 balance) public pure returns (uint256) {
        return balance.total();
    }

    function totals(bytes32[] memory balances) public pure returns (uint256[] memory result) {
        (result, ) = BalanceAllocation.totalsAndLastChangeBlock(balances);
    }

    function cash(bytes32 balance) public pure returns (uint256) {
        return balance.cash();
    }

    function managed(bytes32 balance) public pure returns (uint256) {
        return balance.managed();
    }

    function lastChangeBlock(bytes32 balance) public pure returns (uint256) {
        return balance.lastChangeBlock();
    }

    function isNotZero(bytes32 balance) public pure returns (bool) {
        return balance.isNotZero();
    }

    function isZero(bytes32 balance) public pure returns (bool) {
        return balance.isZero();
    }

    function toBalance(
        uint256 _cash,
        uint256 _managed,
        uint256 _lastChangeBlock
    ) public pure returns (bytes32) {
        return BalanceAllocation.toBalance(_cash, _managed, _lastChangeBlock);
    }

    function increaseCash(bytes32 balance, uint256 amount) public view returns (bytes32) {
        return balance.increaseCash(amount);
    }

    function decreaseCash(bytes32 balance, uint256 amount) public view returns (bytes32) {
        return balance.decreaseCash(amount);
    }

    function cashToManaged(bytes32 balance, uint256 amount) public pure returns (bytes32) {
        return balance.cashToManaged(amount);
    }

    function managedToCash(bytes32 balance, uint256 amount) public pure returns (bytes32) {
        return balance.managedToCash(amount);
    }

    function setManaged(bytes32 balance, uint256 newManaged) public view returns (bytes32) {
        return balance.setManaged(newManaged);
    }

    function fromSharedToBalanceA(bytes32 sharedCash, bytes32 sharedManaged) public pure returns (bytes32) {
        return BalanceAllocation.fromSharedToBalanceA(sharedCash, sharedManaged);
    }

    function fromSharedToBalanceB(bytes32 sharedCash, bytes32 sharedManaged) public pure returns (bytes32) {
        return BalanceAllocation.fromSharedToBalanceB(sharedCash, sharedManaged);
    }

    function toSharedCash(bytes32 tokenABalance, bytes32 tokenBBalance) public pure returns (bytes32) {
        return BalanceAllocation.toSharedCash(tokenABalance, tokenBBalance);
    }

    function toSharedManaged(bytes32 tokenABalance, bytes32 tokenBBalance) public pure returns (bytes32) {
        return BalanceAllocation.toSharedManaged(tokenABalance, tokenBBalance);
    }
}
