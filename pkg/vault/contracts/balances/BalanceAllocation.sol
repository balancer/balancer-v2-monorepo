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

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

// This library is used to create a data structure that represents a token's balance for a Pool. 'cash' is how many
// tokens the Pool has sitting inside of the Vault. 'managed' is how many tokens were withdrawn from the Vault by the
// Pool's Asset Manager. 'total' is the sum of these two, and represents the Pool's total token balance, including
// tokens that are *not* inside of the Vault.
//
// 'cash' is updated whenever tokens enter and exit the Vault, while 'managed' is only updated if the reason tokens are
// moving is due to an Asset Manager action. This is reflected in the different methods available: 'increaseCash'
// and 'decreaseCash' for swaps and add/remove liquidity events, and 'cashToManaged' and 'managedToCash' for events
// transferring funds to and from the Asset Manager.
//
// The Vault disallows the Pool's 'cash' from becoming negative. In other words, it can never use any tokens that are
// not inside the Vault.
//
// One of the goals of this library is to store the entire token balance in a single storage slot, which is why we use
// 112 bit unsigned integers for 'cash' and 'managed'. For consistency, we also disallow any combination of 'cash' and
// 'managed' that yields a 'total' that doesn't fit in 112 bits.
//
// The remaining 32 bits of the slot are used to store the most recent block when the total balance changed. This
// can be used to implement price oracles that are resilient to 'sandwich' attacks.
//
// We could use a Solidity struct to pack these three values together in a single storage slot, but unfortunately
// Solidity only allows for structs to live in either storage, calldata or memory. Because a memory struct still takes
// up a slot in the stack (to store its memory location), and because the entire balance fits in a single stack slot
// (two 112 bit values plus the 32 bit block), using memory is strictly less gas performant. Therefore, we do manual
// packing and unpacking.
//
// Since we cannot define new types, we rely on bytes32 to represent these values instead, as it doesn't have any
// associated arithmetic operations and therefore reduces the chance of misuse.
library BalanceAllocation {
    using Math for uint256;

    // The 'cash' portion of the balance is stored in the least significant 112 bits of a 256 bit word, while the
    // 'managed' part uses the following 112 bits. The most significant 32 bits are used to store the block

    /**
     * @dev Returns the total amount of Pool tokens, including those that are not currently in the Vault ('managed').
     */
    function total(bytes32 balance) internal pure returns (uint256) {
        // Since 'cash' and 'managed' are 112 bit values, we don't need checked arithmetic. Additionally, `toBalance`
        // ensures that 'total' always fits in 112 bits.
        return cash(balance) + managed(balance);
    }

    /**
     * @dev Returns the amount of Pool tokens currently in the Vault.
     */
    function cash(bytes32 balance) internal pure returns (uint256) {
        uint256 mask = 2**(112) - 1;
        return uint256(balance) & mask;
    }

    /**
     * @dev Returns the amount of Pool tokens that are being managed by an Asset Manager.
     */
    function managed(bytes32 balance) internal pure returns (uint256) {
        uint256 mask = 2**(112) - 1;
        return uint256(balance >> 112) & mask;
    }

    /**
     * @dev Returns the last block when the total balance changed.
     */
    function lastChangeBlock(bytes32 balance) internal pure returns (uint256) {
        uint256 mask = 2**(32) - 1;
        return uint256(balance >> 224) & mask;
    }

    /**
     * @dev Returns the difference in 'managed' between two balances.
     */
    function managedDelta(bytes32 newBalance, bytes32 oldBalance) internal pure returns (int256) {
        // Because `managed` is a 112 bit value, we can safely perform unchecked arithmetic in 256 bits.
        return int256(managed(newBalance)) - int256(managed(oldBalance));
    }

    /**
     * @dev Returns the total balance for each entry in `balances`, as well as the latest block when the total
     * balance of *any* of them last changed.
     */
    function totalsAndLastChangeBlock(bytes32[] memory balances)
        internal
        pure
        returns (
            uint256[] memory results,
            uint256 lastChangeBlock_ // Avoid shadowing
        )
    {
        results = new uint256[](balances.length);
        lastChangeBlock_ = 0;

        for (uint256 i = 0; i < results.length; i++) {
            bytes32 balance = balances[i];
            results[i] = total(balance);
            lastChangeBlock_ = Math.max(lastChangeBlock_, lastChangeBlock(balance));
        }
    }

    /**
     * @dev Returns true if `balance`'s 'total' balance is zero. Costs less gas than computing 'total' and comparing
     * with zero.
     */
    function isZero(bytes32 balance) internal pure returns (bool) {
        // We simply need to check the least significant 224 bytes of the word: the block does not affect this.
        uint256 mask = 2**(224) - 1;
        return (uint256(balance) & mask) == 0;
    }

    /**
     * @dev Returns true if `balance`'s 'total' balance is not zero. Costs less gas than computing 'total' and comparing
     * with zero.
     */
    function isNotZero(bytes32 balance) internal pure returns (bool) {
        return !isZero(balance);
    }

    /**
     * @dev Packs together `cash` and `managed` amounts with a block to create a balance value.
     *
     * For consistency, this also checks that the sum of `cash` and `managed` (`total`) fits in 112 bits.
     */
    function toBalance(
        uint256 _cash,
        uint256 _managed,
        uint256 _blockNumber
    ) internal pure returns (bytes32) {
        uint256 _total = _cash + _managed;

        // Since both 'cash' and 'managed' are positive integers, by checking that their sum ('total') fits in 112 bits
        // we are also indirectly checking that both 'cash' and 'managed' themselves fit in 112 bits.
        _require(_total >= _cash && _total < 2**112, Errors.BALANCE_TOTAL_OVERFLOW);

        // We assume the block fits in 32 bits - this is expected to hold for at least a few decades.
        return _pack(_cash, _managed, _blockNumber);
    }

    /**
     * @dev Increases a Pool's 'cash' (and therefore its 'total'). Called when Pool tokens are sent to the Vault (except
     * for Asset Manager deposits).
     *
     * Updates the last total balance change block, even if `amount` is zero.
     */
    function increaseCash(bytes32 balance, uint256 amount) internal view returns (bytes32) {
        uint256 newCash = cash(balance).add(amount);
        uint256 currentManaged = managed(balance);
        uint256 newLastChangeBlock = block.number;

        return toBalance(newCash, currentManaged, newLastChangeBlock);
    }

    /**
     * @dev Decreases a Pool's 'cash' (and therefore its 'total'). Called when Pool tokens are sent from the Vault
     * (except for Asset Manager withdrawals).
     *
     * Updates the last total balance change block, even if `amount` is zero.
     */
    function decreaseCash(bytes32 balance, uint256 amount) internal view returns (bytes32) {
        uint256 newCash = cash(balance).sub(amount);
        uint256 currentManaged = managed(balance);
        uint256 newLastChangeBlock = block.number;

        return toBalance(newCash, currentManaged, newLastChangeBlock);
    }

    /**
     * @dev Moves 'cash' into 'managed', leaving 'total' unchanged. Called when an Asset Manager withdraws Pool tokens
     * from the Vault.
     */
    function cashToManaged(bytes32 balance, uint256 amount) internal pure returns (bytes32) {
        uint256 newCash = cash(balance).sub(amount);
        uint256 newManaged = managed(balance).add(amount);
        uint256 currentLastChangeBlock = lastChangeBlock(balance);

        return toBalance(newCash, newManaged, currentLastChangeBlock);
    }

    /**
     * @dev Moves 'managed' into 'cash', leaving 'total' unchanged. Called when an Asset Manager deposits Pool tokens
     * into the Vault.
     */
    function managedToCash(bytes32 balance, uint256 amount) internal pure returns (bytes32) {
        uint256 newCash = cash(balance).add(amount);
        uint256 newManaged = managed(balance).sub(amount);
        uint256 currentLastChangeBlock = lastChangeBlock(balance);

        return toBalance(newCash, newManaged, currentLastChangeBlock);
    }

    /**
     * @dev Sets 'managed' balance to an arbitrary value, changing 'total'. Called when the Asset Manager reports
     * profits or losses. It's the Manager's responsibility to provide a meaningful value.
     *
     * Updates the last total balance change block, even if `newManaged` is equal to the current 'managed' value.
     */
    function setManaged(bytes32 balance, uint256 newManaged) internal view returns (bytes32) {
        uint256 currentCash = cash(balance);
        uint256 newLastChangeBlock = block.number;
        return toBalance(currentCash, newManaged, newLastChangeBlock);
    }

    // Alternative mode for Pools with the Two Token specialization setting

    // Instead of storing cash and external for each 'token in' a single storage slot, Two Token Pools store the cash
    // for both tokens in the same slot, and the managed for both in another one. This reduces the gas cost for swaps,
    // because the only slot that needs to be updated is the one with the cash. However, it also means that managing
    // balances is more cumbersome, as both tokens need to be read/written at the same time.
    //
    // The field with both cash balances packed is called sharedCash, and the one with external amounts is called
    // sharedManaged. These two are collectively called the 'shared' balance fields. In both of these, the portion
    // that corresponds to token A is stored in the least significant 112 bits of a 256 bit word, while token B's part
    // uses the next least significant 112 bits.
    //
    // Because only cash is written to during a swap, we store the last total balance change block with the
    // packed cash fields. Typically Pools have a distinct block per token: in the case of Two Token Pools they
    // are the same.

    /**
     * @dev Extracts the part of the balance that corresponds to token A. This function can be used to decode both
     * shared cash and managed balances.
     */
    function _decodeBalanceA(bytes32 sharedBalance) private pure returns (uint256) {
        uint256 mask = 2**(112) - 1;
        return uint256(sharedBalance) & mask;
    }

    /**
     * @dev Extracts the part of the balance that corresponds to token B. This function can be used to decode both
     * shared cash and managed balances.
     */
    function _decodeBalanceB(bytes32 sharedBalance) private pure returns (uint256) {
        uint256 mask = 2**(112) - 1;
        return uint256(sharedBalance >> 112) & mask;
    }

    // To decode the last balance change block, we can simply use the `blockNumber` function.

    /**
     * @dev Unpacks the shared token A and token B cash and managed balances into the balance for token A.
     */
    function fromSharedToBalanceA(bytes32 sharedCash, bytes32 sharedManaged) internal pure returns (bytes32) {
        // Note that we extract the block from the sharedCash field, which is the one that is updated by swaps.
        // Both token A and token B use the same block
        return toBalance(_decodeBalanceA(sharedCash), _decodeBalanceA(sharedManaged), lastChangeBlock(sharedCash));
    }

    /**
     * @dev Unpacks the shared token A and token B cash and managed balances into the balance for token B.
     */
    function fromSharedToBalanceB(bytes32 sharedCash, bytes32 sharedManaged) internal pure returns (bytes32) {
        // Note that we extract the block from the sharedCash field, which is the one that is updated by swaps.
        // Both token A and token B use the same block
        return toBalance(_decodeBalanceB(sharedCash), _decodeBalanceB(sharedManaged), lastChangeBlock(sharedCash));
    }

    /**
     * @dev Returns the sharedCash shared field, given the current balances for token A and token B.
     */
    function toSharedCash(bytes32 tokenABalance, bytes32 tokenBBalance) internal pure returns (bytes32) {
        // Both balances are assigned the same block  Since it is possible a single one of them has changed (for
        // example, in an Asset Manager update), we keep the latest (largest) one.
        uint32 newLastChangeBlock = uint32(Math.max(lastChangeBlock(tokenABalance), lastChangeBlock(tokenBBalance)));

        return _pack(cash(tokenABalance), cash(tokenBBalance), newLastChangeBlock);
    }

    /**
     * @dev Returns the sharedManaged shared field, given the current balances for token A and token B.
     */
    function toSharedManaged(bytes32 tokenABalance, bytes32 tokenBBalance) internal pure returns (bytes32) {
        // We don't bother storing a last change block, as it is read from the shared cash field.
        return _pack(managed(tokenABalance), managed(tokenBBalance), 0);
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
        return bytes32((_mostSignificant << 224) + (_midSignificant << 112) + _leastSignificant);
    }
}
