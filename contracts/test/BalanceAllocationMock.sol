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

import "../vault/balances/BalanceAllocation.sol";

contract BalanceAllocationMock {
    using BalanceAllocation for bytes32;

    function cashBalance(bytes32 balance) public pure returns (uint128) {
        return balance.cashBalance();
    }

    function managedBalance(bytes32 balance) public pure returns (uint128) {
        return balance.managedBalance();
    }

    function totalBalance(bytes32 balance) public pure returns (uint128) {
        return balance.totalBalance();
    }

    function toBalance(uint128 _cashBalance, uint128 _managedBalance) public pure returns (bytes32) {
        return BalanceAllocation.toBalance(_cashBalance, _managedBalance);
    }

    function increaseCash(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.increaseCash(amount);
    }

    function decreaseCash(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.decreaseCash(amount);
    }

    function cashToManaged(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.cashToManaged(amount);
    }

    function managedToCash(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.managedToCash(amount);
    }

    function setManagedBalance(bytes32 balance, uint128 newManagedBalance) public pure returns (bytes32) {
        return balance.setManagedBalance(newManagedBalance);
    }

    function isManaged(bytes32 balance) public pure returns (bool) {
        return balance.isManaged();
    }

    function fromSharedToBalanceA(bytes32 cashACashB, bytes32 externalAexternalB) public pure returns (bytes32) {
        return BalanceAllocation.fromSharedToBalanceA(cashACashB, externalAexternalB);
    }

    function fromSharedToBalanceB(bytes32 cashACashB, bytes32 externalAexternalB) public pure returns (bytes32) {
        return BalanceAllocation.fromSharedToBalanceB(cashACashB, externalAexternalB);
    }

    function toSharedCash(bytes32 tokenABalance, bytes32 tokenBBalance) public pure returns (bytes32) {
        return BalanceAllocation.toSharedCash(tokenABalance, tokenBBalance);
    }

    function toSharedManaged(bytes32 tokenABalance, bytes32 tokenBBalance) public pure returns (bytes32) {
        return BalanceAllocation.toSharedManaged(tokenABalance, tokenBBalance);
    }
}
