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

import "../../math/FixedPoint.sol";

// This library is used to create a data structure that represents a token's balance for a Pool. 'cash' is how many
// tokens the Pool has sitting inside of the Vault. 'external' is how many tokens were withdrawn from the Vault by the
// Pool's Asset Manager. 'total' is the sum of these two, and represents the Pool's total token balance, including
// tokens that are *not* inside of the Vault.
//
// 'cash' is updated whenever tokens enter and exit the Vault, while 'external' is only updated if the reason tokens are
// moving is due to an Asset Manager action. This is reflected in the different methods available: 'increaseCash'
// and 'decreaseCash' for swaps and add/remove liquidity events, and 'cashToExternal' and 'externalToCash' for
// events transferring funds to and from the asset manager.
//
// The Vault disallows the Pool's 'cash' ever becoming negative, in other words, it can never use any tokens that
// are not inside of the Vault.
//
// One of the goals of this library is to store the entire token balance in a single storage slot, which is we we use
// 128 bit unsigned integers for 'cash' and 'external'. Since 'total' is also a 128 bit unsigned value, any combination
// of 'cash' and 'external' that yields a 'total' that doesn't fit in that range is disallowed.
//
// We could use a Solidity struct to pack these two values together in a single storage slot, but unfortunately Solidity
// only allows for structs to live in either storage, calldata or memory. Because a memory struct still takes up a
// slot in the stack (to store its memory location), and because the entire balance fits in a single stack slot (two
// 128 bit values), using memory is strictly less gas performant. Therefore, we do manual packing and unpacking. The
// type we use to represent these values is bytes32, as it doesn't have any arithmetic operations and therefore reduces
// the chance of misuse.
library BalanceAllocation {
    using FixedPoint for uint128;

    // The 'cash' portion of the balance is stored in the least significant 128 bits of a 256 bit word, while the
    // 'external' part uses the most significant 128 bits.

    // Mask used to encode/decode pool balances into 'cash' and 'external' balances
    uint128 private constant _MASK = 2**(128) - 1;

    /**
     * @dev The amount of Pool tokens currently in the Vault.
     */
    function cashBalance(bytes32 balance) internal pure returns (uint128) {
        return uint128(uint256(balance)) & _MASK;
    }

    /**
     * @dev The amount of Pool tokens that have been withdrawn by its Asset Manager.
     */
    function externalBalance(bytes32 balance) internal pure returns (uint128) {
        return uint128((uint256(balance) >> 128) & _MASK);
    }

    /**
     * @dev The total amount of Pool tokens, including those that are not currently in the Vault ('external').
     */
    function totalBalance(bytes32 balance) internal pure returns (uint128) {
        return cashBalance(balance).add128(externalBalance(balance));
    }

    /**
     * @dev Tell whether the total amount is not zero
     */
    function isNotZero(bytes32 balance) internal pure returns (bool) {
        return !isZero(balance);
    }

    /**
     * @dev Tell whether the total amount is zero
     */
    function isZero(bytes32 balance) internal pure returns (bool) {
        return balance == bytes32(0);
    }

    /**
     * @dev Packs together cash and external amounts to create a balance value.
     *
     * Critically, this also checks the sum of cash and external doesn't overflow, that is, that `total()` can be
     * computed.
     */
    function toBalance(uint128 _cashBalance, uint128 _externalBalance) internal pure returns (bytes32) {
        uint128 total = _cashBalance + _externalBalance;
        require(total >= _cashBalance, "BALANCE_TOTAL_OVERFLOW");

        return bytes32((uint256(_externalBalance) << 128) | _cashBalance);
    }

    /**
     * @dev Increases a Pool's 'cash' (and therefore its 'total'). Called when Pool tokens are sent to the Vault (except
     * when an Asset Manager action decreases the external balance).
     */
    function increaseCash(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCashBalance = cashBalance(balance).add128(amount);
        uint128 newExternalBalance = externalBalance(balance);

        return toBalance(newCashBalance, newExternalBalance);
    }

    /**
     * @dev Decreases a Pool's 'cash' (and therefore its 'total'). Called when Pool tokens are sent from the Vault
     * (except as an Asset Manager action that increases the external balance).
     */
    function decreaseCash(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCashBalance = cashBalance(balance).sub128(amount);
        uint128 newExternalBalance = externalBalance(balance);

        return toBalance(newCashBalance, newExternalBalance);
    }

    /**
     * @dev Moves 'cash' into 'external', leaving 'total' unchanged. Called when Pool tokens are sent from the Vault
     * when an Asset Manager action increases the external balance.
     */
    function cashToExternal(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCashBalance = cashBalance(balance).sub128(amount);
        uint128 newExternalBalance = externalBalance(balance).add128(amount);

        return toBalance(newCashBalance, newExternalBalance);
    }

    /**
     * @dev Moves 'external' into 'cash', leaving 'total' unchanged. Called when Pool tokens are sent to the Vault when
     * an Asset Manager action decreases the external balance.
     */
    function externalToCash(bytes32 balance, uint128 amount) internal pure returns (bytes32) {
        uint128 newCashBalance = cashBalance(balance).add128(amount);
        uint128 newExternalBalance = externalBalance(balance).sub128(amount);

        return toBalance(newCashBalance, newExternalBalance);
    }

    /**
     * @dev Sets 'external' balance to an arbitrary value, changing 'total'. Called when the Asset Manager reports
     * profits or losses. It's the Manager's responsibility to provide a meaningful value.
     */
    function setExternalBalance(bytes32 balance, uint128 newExternalBalance) internal pure returns (bytes32) {
        uint128 newCashBalance = cashBalance(balance);

        return toBalance(newCashBalance, newExternalBalance);
    }

    /**
     * @dev Returns true if the balance has an external component, or in other words, if it is not fully liquid.
     */
    function hasExternalBalance(bytes32 balance) internal pure returns (bool) {
        return externalBalance(balance) > 0;
    }

    // Alternative mode for two token pools

    // Instead of storing cash and external for each token in a single storage slot, two token pools store the cash for
    // both tokens in the same slot, and the external for both in another one. This reduces the gas cost for swaps,
    // because the only slot that needs to be updated is the one with the cash. However, it also means that managing
    // balances is more cumbersome, as both tokens need to be read/written at the same time.
    // The field with both cash balances packed is called sharedCash, and the one with external amounts is called
    // sharedExternal. These two are collectively called the 'shared' balance fields. In both of these, the portion
    // that corresponds to token A is stored in the most significant 128 bits of a 256 bit word, while token B's part
    // uses the least significant 128 bits.

    /**
     * @dev Unpacks the shared token A and token B cash and external balances into the balance for token A.
     */
    function fromSharedToBalanceA(bytes32 sharedCash, bytes32 sharedExternal) internal pure returns (bytes32) {
        return toBalance(uint128(uint256(sharedCash >> 128) & _MASK), uint128(uint256(sharedExternal >> 128) & _MASK));
    }

    /**
     * @dev Unpacks the shared token A and token B cash and external balances into the balance for token B.
     */
    function fromSharedToBalanceB(bytes32 sharedCash, bytes32 sharedExternal) internal pure returns (bytes32) {
        return toBalance(uint128(uint256(sharedCash) & _MASK), uint128(uint256(sharedExternal) & _MASK));
    }

    /**
     * @dev Returns the sharedCash shared field, given the current balances for tokenA and tokenB.
     */
    function toSharedCash(bytes32 tokenABalance, bytes32 tokenBBalance) internal pure returns (bytes32) {
        return bytes32((uint256(cashBalance(tokenABalance)) << 128) + cashBalance(tokenBBalance));
    }

    /**
     * @dev Returns the sharedExternal shared field, given the current balances for tokenA and tokenB.
     */
    function toSharedExternal(bytes32 tokenABalance, bytes32 tokenBBalance) internal pure returns (bytes32) {
        return bytes32((uint256(externalBalance(tokenABalance)) << 128) + externalBalance(tokenBBalance));
    }
}
