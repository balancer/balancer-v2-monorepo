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

import "../vault/balances/CashInvested.sol";

contract CashInvestedMock {
    using CashInvested for bytes32;

    function cash(bytes32 balance) public pure returns (uint128) {
        return balance.cash();
    }

    function invested(bytes32 balance) public pure returns (uint128) {
        return balance.invested();
    }

    function total(bytes32 balance) public pure returns (uint128) {
        return balance.total();
    }

    function toBalance(uint128 cashBalance, uint128 investedBalance) public pure returns (bytes32) {
        return CashInvested.toBalance(cashBalance, investedBalance);
    }

    function increaseCash(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.increaseCash(amount);
    }

    function decreaseCash(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.decreaseCash(amount);
    }

    function cashToInvested(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.cashToInvested(amount);
    }

    function investedToCash(bytes32 balance, uint128 amount) public pure returns (bytes32) {
        return balance.investedToCash(amount);
    }

    function setInvested(bytes32 balance, uint128 newInvested) public pure returns (bytes32) {
        return balance.setInvested(newInvested);
    }

    function isInvested(bytes32 balance) public pure returns (bool) {
        return balance.isInvested();
    }

    function fromSharedToBalanceA(bytes32 cashACashB, bytes32 investedAInvestedB) public pure returns (bytes32) {
        return CashInvested.fromSharedToBalanceA(cashACashB, investedAInvestedB);
    }

    function fromSharedToBalanceB(bytes32 cashACashB, bytes32 investedAInvestedB) public pure returns (bytes32) {
        return CashInvested.fromSharedToBalanceB(cashACashB, investedAInvestedB);
    }

    function toSharedCash(bytes32 tokenABalance, bytes32 tokenBBalance) public pure returns (bytes32) {
        return CashInvested.toSharedCash(tokenABalance, tokenBBalance);
    }

    function toSharedInvested(bytes32 tokenABalance, bytes32 tokenBBalance) public pure returns (bytes32) {
        return CashInvested.toSharedInvested(tokenABalance, tokenBBalance);
    }
}
