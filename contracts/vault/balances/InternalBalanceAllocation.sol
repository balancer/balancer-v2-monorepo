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

import "../../lib/math/Math.sol";

library InternalBalanceAllocation {
    using Math for uint256;

    /**
     * @dev Returns the actual amount of internal balance.
     */
    function actual(bytes32 balance) internal pure returns (uint256) {
        uint256 mask = 2**(112) - 1;
        return uint256(balance) & mask;
    }

    /**
     * @dev Returns the cached amount of internal balance.
     */
    function cached(bytes32 balance) internal pure returns (uint256) {
        uint256 mask = 2**(112) - 1;
        return uint256(balance >> 112) & mask;
    }

    /**
     * @dev Returns the last block number when an internal balance was cached.
     */
    function blockNumber(bytes32 balance) internal pure returns (uint256) {
        uint256 mask = 2**(32) - 1;
        return uint256(balance >> 224) & mask;
    }

    /**
     * @dev Increases an internal balance and handles its cached value if requested.
     */
    function increase(
        bytes32 balance,
        uint256 amount,
        bool track
    ) internal view returns (bytes32) {
        uint256 newActual = actual(balance).add(amount);
        uint256 newCached = cached(balance);
        uint256 newBlockNumber = blockNumber(balance);

        if (track) {
            if (newBlockNumber == block.number) {
                newCached = newCached.add(amount);
            } else {
                newCached = amount;
                newBlockNumber = block.number;
            }
        }

        return toInternalBalance(newActual, newCached, newBlockNumber);
    }

    /**
     * @dev Decreases an internal balance and handles its cached value if requested.
     */
    function decrease(
        bytes32 balance,
        uint256 amount,
        bool capped
    )
        internal
        view
        returns (
            bytes32,
            uint256,
            uint256
        )
    {
        uint256 currentActual = actual(balance);
        require(capped || currentActual >= amount, "INSUFFICIENT_INTERNAL_BALANCE");

        // We know the decreased amount will be always the minimum between the actual value and the given amount.
        // If the given amount was greater than the actual value and it wasn't requested to be capped, then it
        // was caught by the require above
        uint256 decreased = Math.min(currentActual, amount);
        uint256 newActual = currentActual - decreased;

        uint256 newCached = 0;
        uint256 newBlockNumber = 0;
        uint256 taxableAmount = amount;

        uint256 lastBlockNumber = blockNumber(balance);
        if (lastBlockNumber == block.number) {
            // A user could be decreasing its internal balance by a number greater than its cached value.
            // Then we should always do a sub capped to zero.
            uint256 currentCached = cached(balance);
            newCached = currentCached >= amount ? currentCached - amount : 0;
            newBlockNumber = lastBlockNumber;
            taxableAmount = currentCached >= amount ? 0 : amount - currentCached;
        }

        // Note that we consider the case where the current block number doesn't match with the last one as a
        // regular decrease. We cannot handle negative cached values, it would be like "credit" for potential
        // future ops in the same block.

        bytes32 newBalance = toInternalBalance(newActual, newCached, newBlockNumber);
        return (newBalance, taxableAmount, decreased);
    }

    /**
     * @dev Packs together actual and cached amounts with a block number to create a balance value.
     * Critically, this also checks both amounts can be packed together in the same slot.
     */
    function toInternalBalance(
        uint256 _actual,
        uint256 _cached,
        uint256 _blockNumber
    ) internal pure returns (bytes32) {
        require(_actual < 2**112 && _cached < 2**112, "INTERNAL_BALANCE_OVERFLOW");
        // We assume the block number will fits in an uint32 - this is expected to hold for at least a few decades.
        return _pack(_actual, _cached, _blockNumber);
    }

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
