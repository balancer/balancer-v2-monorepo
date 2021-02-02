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

import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../../lib/math/Math.sol";

// This library is used to create a data structure that represents a token's balance for a Pool. 'cash' is how many
// tokens the Pool has sitting inside of the Vault. 'managed' is how many tokens were withdrawn from the Vault by the
// Pool's Asset Manager. 'total' is the sum of these two, and represents the Pool's total token balance, including
// tokens that are *not* inside of the Vault.
//
// 'cash' is updated whenever tokens enter and exit the Vault, while 'managed' is only updated if the reason tokens are
// moving is due to an Asset Manager action. This is reflected in the different methods available: 'increaseCash'
// and 'decreaseCash' for swaps and add/remove liquidity events, and 'cashToManaged' and 'managedToCash' for
// events transferring funds to and from the asset manager.
//
// The Vault disallows the Pool's 'cash' ever becoming negative, in other words, it can never use any tokens that
// are not inside of the Vault.
//
// One of the goals of this library is to store the entire token balance in a single storage slot, which is we we use
// 128 bit unsigned integers for 'cash' and 'managed'. Since 'total' is also a 128 bit unsigned value, any combination
// of 'cash' and 'managed' that yields a 'total' that doesn't fit in that range is disallowed.
//
// We could use a Solidity struct to pack these two values together in a single storage slot, but unfortunately Solidity
// only allows for structs to live in either storage, calldata or memory. Because a memory struct still takes up a
// slot in the stack (to store its memory location), and because the entire balance fits in a single stack slot (two
// 128 bit values), using memory is strictly less gas performant. Therefore, we do manual packing and unpacking. The
// type we use to represent these values is bytes32, as it doesn't have any arithmetic operations and therefore reduces
// the chance of misuse.
library BalanceAllocation {
    using Math for uint256;
    using SafeCast for uint256;

    // The 'cash' portion of the balance is stored in the least significant 128 bits of a 256 bit word, while the
    // 'managed' part uses the most significant 128 bits.

    // Mask used to encode/decode pool balances into 'cash' and 'managed' balances
    uint256 private constant _MASK = 2**(128) - 1;

    /**
     * @dev The amount of Pool tokens currently in the Vault.
     */
    function cashBalance(bytes32 balance) internal pure returns (uint256) {
        return uint256(balance) & _MASK;
    }

    /**
     * @dev The amount of Pool tokens that have been withdrawn by its Asset Manager.
     */
    function managedBalance(bytes32 balance) internal pure returns (uint256) {
        return (uint256(balance) >> 128) & _MASK;
    }

    /**
     * @dev The total amount of Pool tokens, including those that are not currently in the Vault ('managed').
     */
    function totalBalance(bytes32 balance) internal pure returns (uint256) {
        return cashBalance(balance).add(managedBalance(balance));
    }

    /**
     * @dev Computes the total balance of the Pool tokens.
     */
    function totalBalances(bytes32[] memory balances) internal pure returns (uint256[] memory totals) {
        totals = new uint256[](balances.length);
        for (uint256 i = 0; i < totals.length; i++) {
            totals[i] = totalBalance(balances[i]);
        }
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
    function toBalance(uint256 _cashBalance, uint256 _managedBalance) internal pure returns (bytes32) {
        uint256 total = _cashBalance + _managedBalance;
        require(total >= _cashBalance && total < 2**128, "BALANCE_TOTAL_OVERFLOW");

        return bytes32((_managedBalance << 128) | _cashBalance);
    }

    /**
     * @dev Increases a Pool's 'cash' (and therefore its 'total'). Called when Pool tokens are sent to the Vault (except
     * when an Asset Manager action decreases the managed balance).
     */
    function increaseCash(bytes32 balance, uint256 amount) internal pure returns (bytes32) {
        uint256 newCashBalance = cashBalance(balance).add(amount);
        uint256 newManagedBalance = managedBalance(balance);

        return toBalance(newCashBalance, newManagedBalance);
    }

    /**
     * @dev Decreases a Pool's 'cash' (and therefore its 'total'). Called when Pool tokens are sent from the Vault
     * (except as an Asset Manager action that increases the managed balance).
     */
    function decreaseCash(bytes32 balance, uint256 amount) internal pure returns (bytes32) {
        uint256 newCashBalance = cashBalance(balance).sub(amount);
        uint256 newManagedBalance = managedBalance(balance);

        return toBalance(newCashBalance, newManagedBalance);
    }

    /**
     * @dev Moves 'cash' into 'managed', leaving 'total' unchanged. Called when Pool tokens are sent from the Vault
     * when an Asset Manager action increases the managed balance.
     */
    function cashToManaged(bytes32 balance, uint256 amount) internal pure returns (bytes32) {
        uint256 newCashBalance = cashBalance(balance).sub(amount);
        uint256 newManagedBalance = managedBalance(balance).add(amount);

        return toBalance(newCashBalance, newManagedBalance);
    }

    /**
     * @dev Moves 'managed' into 'cash', leaving 'total' unchanged. Called when Pool tokens are sent to the Vault when
     * an Asset Manager action decreases the managed balance.
     */
    function managedToCash(bytes32 balance, uint256 amount) internal pure returns (bytes32) {
        uint256 newCashBalance = cashBalance(balance).add(amount);
        uint256 newManagedBalance = managedBalance(balance).sub(amount);

        return toBalance(newCashBalance, newManagedBalance);
    }

    /**
     * @dev Sets 'managed' balance to an arbitrary value, changing 'total'. Called when the Asset Manager reports
     * profits or losses. It's the Manager's responsibility to provide a meaningful value.
     */
    function setManagedBalance(bytes32 balance, uint256 newManagedBalance) internal pure returns (bytes32) {
        uint256 newCashBalance = cashBalance(balance);

        return toBalance(newCashBalance, newManagedBalance);
    }

    // Alternative mode for two token pools

    // Instead of storing cash and external for each token in a single storage slot, two token pools store the cash for
    // both tokens in the same slot, and the external for both in another one. This reduces the gas cost for swaps,
    // because the only slot that needs to be updated is the one with the cash. However, it also means that managing
    // balances is more cumbersome, as both tokens need to be read/written at the same time.
    // The field with both cash balances packed is called sharedCash, and the one with external amounts is called
    // sharedManaged. These two are collectively called the 'shared' balance fields. In both of these, the portion
    // that corresponds to token A is stored in the most significant 128 bits of a 256 bit word, while token B's part
    // uses the least significant 128 bits.

    /**
     * @dev Unpacks the shared token A and token B cash and managed balances into the balance for token A.
     */
    function fromSharedToBalanceA(bytes32 sharedCash, bytes32 sharedManaged) internal pure returns (bytes32) {
        return toBalance(_decodeBalanceA(sharedCash), _decodeBalanceA(sharedManaged));
    }

    /**
     * @dev Unpacks the shared token A and token B cash and managed balances into the balance for token B.
     */
    function fromSharedToBalanceB(bytes32 sharedCash, bytes32 sharedManaged) internal pure returns (bytes32) {
        return toBalance(_decodeBalanceB(sharedCash), _decodeBalanceB(sharedManaged));
    }

    /**
     * @dev Returns the sharedCash shared field, given the current balances for tokenA and tokenB.
     */
    function toSharedCash(bytes32 tokenABalance, bytes32 tokenBBalance) internal pure returns (bytes32) {
        return bytes32((uint256(cashBalance(tokenABalance)) << 128) + cashBalance(tokenBBalance));
    }

    /**
     * @dev Returns the sharedManaged shared field, given the current balances for tokenA and tokenB.
     */
    function toSharedManaged(bytes32 tokenABalance, bytes32 tokenBBalance) internal pure returns (bytes32) {
        return bytes32((uint256(managedBalance(tokenABalance)) << 128) + managedBalance(tokenBBalance));
    }

    /**
     * @dev Unpacks the balance corresponding to token A for a shared balance
     * Note that this function can be used to decode both cash and managed balances.
     */
    function _decodeBalanceA(bytes32 sharedBalance) private pure returns (uint256) {
        return uint256(sharedBalance >> 128) & _MASK;
    }

    /**
     * @dev Unpacks the balance corresponding to token B for a shared balance
     * Note that this function can be used to decode both cash and managed balances.
     */
    function _decodeBalanceB(bytes32 sharedBalance) private pure returns (uint256) {
        return uint256(sharedBalance) & _MASK;
    }
}
