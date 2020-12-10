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

import "../math/FixedPoint.sol";

// This library is used to create a data structure that represents a token's balance for a Pool. 'cash' is how many
// tokens the Pool has sitting inside of the Vault. 'invested' is how many tokens were withdrawn from the Vault by the
// Pool's Investment Manager. 'total' is the sum of these two, and represents the Pool's total token balance, including
// tokens that are *not* inside of the Vault.
//
// 'cash' is updated whenever tokens enter and exit the Vault, while 'invested' is only updated if the reason tokens are
// moving is due to an Investment Manager action. This is reflected on the different methods available: 'increaseCash'
// and 'decreaseCash' for swaps and add/remove liquidity events, and 'cashToInvested' and 'investedToCash' for
// investment and divestment events.
//
// The Vault disallows the Pool's 'cash' ever becoming negative, in other words, it can never use any tokens that
// are not inside of the Vault.
//
// One of the goals of this library is to store the entire token balance in a single storage slot, which is we we use
// 128 bit unsigned integers for 'cash' and 'invested'. Since 'total' is also a 128 bit unsigned value, any combination
// of 'cash' and 'invested' that yields a 'total' that doesn't fit in that range is disallowed.
//
// We could use a Solidity struct to pack these two values together in a single storage slot, but unfortunately Solidity
// only allows for structs to live in either storage, calldata or memory. Because a memory struct still takes up a
// slot in the stack (to store its memory location), and because the entire balance fits in a single stack slot (two
// 128 bit values), using memory is strictly less gas performant. Therefore, we do manual packing and unpacking. The
// type we use to represent these values is bytes32, as it doesn't have any arithmetic operations and therefore reduces
// the chance of misuse.
library PoolBalance {
    using FixedPoint for uint128;

    // Mask used to encode/decode pool balances into 'cash' and 'invested' balances
    uint128 private constant _MASK = 2**(128) - 1;

    // The 'cash' portion of the balance is stored in the least significant 128 bits of a 256 bit word, while the
    // 'invested' part uses the most significant 128 bits.

    /**
     * @dev The amount of Pool tokens currently in the Vault.
     */
    function cash(bytes32 balance) internal pure returns (uint128) {
        return uint128(uint256(balance)) & _MASK;
    }

    /**
     * @dev The amount of Pool tokens that have been withdrawn by its Investment Manager.
     */
    function invested(bytes32 balance) internal pure returns (uint128) {
        return uint128((uint256(balance) >> 128) & _MASK);
    }

    /**
     * @dev The total amount of Pool tokens, including those that are not currently in the Vault ('invested').
     */
    function total(bytes32 balance) internal pure returns (uint128) {
        return cash(balance).add128(invested(balance));
    }

    /**
     * @dev Packs together cash and invested amounts to create a balance value.
     */
    function toBalance(uint128 cashBalance, uint128 investedBalance) internal pure returns (bytes32) {
        uint128 totalBalance = cashBalance + investedBalance;
        require(totalBalance >= cashBalance, "BALANCE_TOTAL_OVERFLOW");

        return bytes32((uint256(investedBalance) << 128) | cashBalance);
    }

    /**
     * @dev Increases a Pool's 'cash' (and therefore its 'total'). Called when Pool tokens are sent to the Vault (except
     * as an Investment Manager divest event).
     */
    function increaseCash(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCash = cash(balance).add128(amount);
        uint128 newInvested = invested(balance);

        return toBalance(newCash, newInvested);
    }

    /**
     * @dev Decreases a Pool's 'cash' (and therefore its 'total'). Called when Pool tokens are sent from the Vault
     * (except as an Investment Manager invest event).
     */
    function decreaseCash(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCash = cash(balance).sub128(amount);
        uint128 newInvested = invested(balance);

        return toBalance(newCash, newInvested);
    }

    /**
     * @dev Moves 'cash' into 'invested', leaving 'total' unchanged. Called when Pool tokens are sent from the Vault as
     * Investment Manager invest events.
     */
    function cashToInvested(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCash = cash(balance).sub128(amount);
        uint128 newInvested = invested(balance).add128(amount);

        return toBalance(newCash, newInvested);
    }

    /**
     * @dev Moves 'invested' into 'cash', leaving 'total' unchanged. Called when Pool tokens are sent to the Vault as
     * Investment Manager divest events.
     */
    function investedToCash(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCash = cash(balance).add128(amount);
        uint128 newInvested = invested(balance).sub128(amount);

        return toBalance(newCash, newInvested);
    }

    /**
     * @dev Sets 'invested' to an arbitrary value, changing 'total'. Called when the Investment Manager reports profits
     * or losses. It's the Manager's responsability to provide a meaningful value.
     */
    function setInvested(bytes32 balance, uint128 newInvested) internal pure returns (bytes32) {
        uint128 newCash = cash(balance);

        return toBalance(newCash, newInvested);
    }
}
