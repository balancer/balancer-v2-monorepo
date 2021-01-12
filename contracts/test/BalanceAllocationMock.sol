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

    function externalBalance(bytes32 balance) public pure returns (uint128) {
        return balance.externalBalance();
    }

    function totalBalance(bytes32 balance) public pure returns (uint128) {
        return balance.totalBalance();
    }

    function toBalance(uint128 _cashBalance, uint128 _externalBalance) public pure returns (bytes32) {
        return BalanceAllocation.toBalance(_cashBalance, _externalBalance);
    }

    function increaseCash(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.increaseCash(amount);
    }

    function decreaseCash(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.decreaseCash(amount);
    }

    function cashToExternal(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.cashToExternal(amount);
    }

    function externalToCash(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.externalToCash(amount);
    }

    function setExternalBalance(bytes32 balance, uint128 newExternalBalance) public pure returns (bytes32) {
        return balance.setExternalBalance(newExternalBalance);
    }

    function hasExternalBalance(bytes32 balance) public pure returns (bool) {
        return balance.hasExternalBalance();
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

    function toSharedExternal(bytes32 tokenABalance, bytes32 tokenBBalance) public pure returns (bytes32) {
        return BalanceAllocation.toSharedExternal(tokenABalance, tokenBBalance);
    }
}
