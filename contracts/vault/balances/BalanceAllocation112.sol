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
// 112 bit unsigned integers for 'cash' and 'managed'. Since 'total' is also a 112 bit unsigned value, any combination
// of 'cash' and 'managed' that yields a 'total' that doesn't fit in that range is disallowed.
//
// We could use a Solidity struct to pack these two values together in a single storage slot, but unfortunately Solidity
// only allows for structs to live in either storage, calldata or memory. Because a memory struct still takes up a
// slot in the stack (to store its memory location), and because the entire balance fits in a single stack slot (two
// 112 bit values), using memory is strictly less gas performant. Therefore, we do manual packing and unpacking. The
// type we use to represent these values is bytes32, as it doesn't have any arithmetic operations and therefore reduces
// the chance of misuse.
library BalanceAllocation112 {
    using Math for uint256;

    // The 'cash' portion of the balance is stored in the least significant 112 bits of a 256 bit word, while the
    // 'managed' part uses the most significant 112 bits.

    /**
     * @dev Computes the total balance of the Pool tokens.
     */
    function totals(bytes32[] memory balances) internal pure returns (uint256[] memory results) {
        results = new uint256[](balances.length);
        for (uint256 i = 0; i < results.length; i++) {
            results[i] = total(balances[i]);
        }
    }

    /**
     * @dev The total amount of Pool tokens, including those that are not currently in the Vault ('managed').
     */
    function total(bytes32 balance) internal pure returns (uint256) {
        return cash(balance).add(managed(balance));
    }

    /**
     * @dev The amount of Pool tokens currently in the Vault.
     */
    function cash(bytes32 balance) internal pure returns (uint256) {
        return _leastSignificant(balance);
    }

    /**
     * @dev The amount of Pool tokens that have been withdrawn by its Asset Manager.
     */
    function managed(bytes32 balance) internal pure returns (uint256) {
        return _midSignificant(balance);
    }

    /**
     * @dev Last block number when given balance was updated
     */
    function blockNumber(bytes32 balance) internal pure returns (uint256) {
        return _mostSignificant(balance);
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
     * @dev Packs together cash and managed amounts without a block number to create a balance value.
     */
    function toBalance(uint256 _cash, uint256 _managed) internal pure returns (bytes32) {
        return toBalance(_cash, _managed, 0);
    }

    /**
     * @dev Packs together cash and managed amounts with a block number to create a balance value.
     *
     * Critically, this also checks the sum of cash and external doesn't overflow, that is, that `total()` can be
     * computed.
     */
    function toBalance(
        uint256 _cash,
        uint256 _managed,
        uint256 _blockNumber
    ) internal pure returns (bytes32) {
        require(_blockNumber < 2**32, "BLOCK_NUM_DOESNT_FIT_IN_32_BITS");

        uint256 balance = _cash + _managed;
        require(balance >= _cash && balance < 2**112, "BALANCE_TOTAL_OVERFLOW");

        return _pack(_cash, _managed, _blockNumber);
    }

    /**
     * @dev Increases a Pool's 'cash' (and therefore its 'total'). Called when Pool tokens are sent to the Vault (except
     * when an Asset Manager action decreases the managed balance).
     */
    function increaseCash(bytes32 balance, uint256 amount) internal pure returns (bytes32) {
        uint256 newCash = cash(balance).add(amount);
        uint256 currentManaged = managed(balance);
        uint256 currentBlockNumber = blockNumber(balance);

        return toBalance(newCash, currentManaged, currentBlockNumber);
    }

    /**
     * @dev Decreases a Pool's 'cash' (and therefore its 'total'). Called when Pool tokens are sent from the Vault
     * (except as an Asset Manager action that increases the managed balance).
     */
    function decreaseCash(bytes32 balance, uint256 amount) internal pure returns (bytes32) {
        uint256 newCash = cash(balance).sub(amount);
        uint256 currentManaged = managed(balance);
        uint256 currentBlockNumber = blockNumber(balance);

        return toBalance(newCash, currentManaged, currentBlockNumber);
    }

    /**
     * @dev Moves 'cash' into 'managed', leaving 'total' unchanged. Called when Pool tokens are sent from the Vault
     * when an Asset Manager action increases the managed balance.
     */
    function cashToManaged(bytes32 balance, uint256 amount) internal pure returns (bytes32) {
        uint256 newCash = cash(balance).sub(amount);
        uint256 newManaged = managed(balance).add(amount);
        uint256 currentBlockNumber = blockNumber(balance);

        return toBalance(newCash, newManaged, currentBlockNumber);
    }

    /**
     * @dev Moves 'managed' into 'cash', leaving 'total' unchanged. Called when Pool tokens are sent to the Vault when
     * an Asset Manager action decreases the managed balance.
     */
    function managedToCash(bytes32 balance, uint256 amount) internal pure returns (bytes32) {
        uint256 newCash = cash(balance).add(amount);
        uint256 newManaged = managed(balance).sub(amount);
        uint256 currentBlockNumber = blockNumber(balance);

        return toBalance(newCash, newManaged, currentBlockNumber);
    }

    /**
     * @dev Sets 'managed' balance to an arbitrary value, changing 'total'. Called when the Asset Manager reports
     * profits or losses. It's the Manager's responsibility to provide a meaningful value.
     */
    function setManaged(bytes32 balance, uint256 newManaged) internal pure returns (bytes32) {
        uint256 currentCash = cash(balance);
        uint256 currentBlockNumber = blockNumber(balance);
        return toBalance(currentCash, newManaged, currentBlockNumber);
    }

    // Alternative mode for two token pools

    // Instead of storing cash and external for each token in a single storage slot, two token pools store the cash for
    // both tokens in the same slot, and the external for both in another one. This reduces the gas cost for swaps,
    // because the only slot that needs to be updated is the one with the cash. However, it also means that managing
    // balances is more cumbersome, as both tokens need to be read/written at the same time.
    // The field with both cash balances packed is called sharedCash, and the one with external amounts is called
    // sharedManaged. These two are collectively called the 'shared' balance fields. In both of these, the portion
    // that corresponds to token A is stored in the least significant 112 bits of a 256 bit word, while token B's part
    // uses the most significant 112 bits.

    /**
     * @dev Unpacks the shared token A and token B cash and managed balances into the balance for token A.
     */
    function fromSharedToBalanceA(bytes32 sharedCash, bytes32 sharedManaged) internal pure returns (bytes32) {
        return toBalance(_decodeBalanceA(sharedCash), _decodeBalanceA(sharedManaged), blockNumber(sharedCash));
    }

    /**
     * @dev Unpacks the shared token A and token B cash and managed balances into the balance for token B.
     */
    function fromSharedToBalanceB(bytes32 sharedCash, bytes32 sharedManaged) internal pure returns (bytes32) {
        return toBalance(_decodeBalanceB(sharedCash), _decodeBalanceB(sharedManaged), blockNumber(sharedCash));
    }

    /**
     * @dev Returns the sharedCash shared field, given the current balances for tokenA and tokenB.
     */
    function toSharedCash(bytes32 tokenABalance, bytes32 tokenBBalance) internal pure returns (bytes32) {
        // Both balances have the block number, since both balances are always updated at the same time it does not
        // mater where we pick it from.
        return _pack(cash(tokenABalance), cash(tokenBBalance), blockNumber(tokenABalance));
    }

    /**
     * @dev Returns the sharedManaged shared field, given the current balances for tokenA and tokenB.
     */
    function toSharedManaged(bytes32 tokenABalance, bytes32 tokenBBalance) internal pure returns (bytes32) {
        return _pack(managed(tokenABalance), managed(tokenBBalance), uint32(0));
    }

    /**
     * @dev Unpacks the balance corresponding to token A for a shared balance
     * Note that this function can be used to decode both cash and managed balances.
     */
    function _decodeBalanceA(bytes32 sharedBalance) private pure returns (uint256) {
        return _leastSignificant(sharedBalance);
    }

    /**
     * @dev Unpacks the balance corresponding to token B for a shared balance
     * Note that this function can be used to decode both cash and managed balances.
     */
    function _decodeBalanceB(bytes32 sharedBalance) private pure returns (uint256) {
        return _midSignificant(sharedBalance);
    }

    // Shared functions

    /**
     * @dev Packs together two uint112 and one uint32 into a bytes32
     */
    function _pack(
        uint256 _leastSignificant,
        uint256 _midSignificant,
        uint256 _mostSignificant
    ) private pure returns (bytes32) {
        return bytes32((_mostSignificant << 224) | (_midSignificant << 112) | _leastSignificant);
    }

    /**
     * @dev Tells the 32 most significant bits of a word.
     * Used to decode the block number.
     */
    function _mostSignificant(bytes32 value) private pure returns (uint256) {
        return _mostSignificant(uint256(value));
    }

    /**
     * @dev Tells the 32 most significant bits of a word.
     * Used to decode the block number.
     */
    function _mostSignificant(uint256 value) private pure returns (uint256) {
        return _masked32(value >> 224);
    }

    /**
     * @dev Tells the 112 mid significant bits of a word.
     * Used to decode the 'managed' balance for regular wrapping or the token B balance for the two tokens special case.
     */
    function _midSignificant(bytes32 value) private pure returns (uint256) {
        return _midSignificant(uint256(value));
    }

    /**
     * @dev Tells the 112 mid significant bits of a word.
     * Used to decode the 'managed' balance for regular wrapping or the token B balance for the two tokens special case.
     */
    function _midSignificant(uint256 value) private pure returns (uint256) {
        return _masked112(value >> 112);
    }

    /**
     * @dev Tells the 112 least significant bits of a word.
     * Used to decode the 'cash' balance for regular wrapping or the token A balance for the two tokens special case.
     */
    function _leastSignificant(bytes32 value) private pure returns (uint256) {
        return _leastSignificant(uint256(value));
    }

    /**
     * @dev Tells the 112 least significant bits of a word.
     * Used to decode the 'cash' balance for regular wrapping or the token A balance for the two tokens special case.
     */
    function _leastSignificant(uint256 value) private pure returns (uint256) {
        return _masked112(value);
    }

    /**
     * @dev Masks a uint256 to uint112
     */
    function _masked112(uint256 value) private pure returns (uint256) {
        uint256 mask = 2**(112) - 1;
        return value & mask;
    }

    /**
     * @dev Masks a uint256 to uint32
     */
    function _masked32(uint256 value) private pure returns (uint256) {
        uint256 mask = 2**(32) - 1;
        return value & mask;
    }
}
