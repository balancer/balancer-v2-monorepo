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
     * @dev Returns the exempt amount of internal balance.
     */
    function exempt(bytes32 balance) internal pure returns (uint256) {
        uint256 mask = 2**(112) - 1;
        return uint256(balance >> 112) & mask;
    }

    /**
     * @dev Returns the last block number when an internal balance exempt was cached.
     */
    function blockNumber(bytes32 balance) internal pure returns (uint256) {
        uint256 mask = 2**(32) - 1;
        return uint256(balance >> 224) & mask;
    }

    /**
     * @dev Increases an internal balance. It can also track the internal balance exempt if requested.
     * In case it is, it will compare the current block number with the last one cached to see if it should
     * reset the exempt amount or increment it. The exempt amount will always be considered in computing
     * the taxable amount when an internal balance is decreased
     */
    function increase(
        bytes32 balance,
        uint256 amount,
        bool trackExempt
    ) internal view returns (bytes32) {
        uint256 newActual = actual(balance).add(amount);
        uint256 newExempt = exempt(balance);
        uint256 newBlockNumber = blockNumber(balance);

        if (trackExempt) {
            if (newBlockNumber == block.number) {
                newExempt = newExempt.add(amount);
            } else {
                newExempt = amount;
                newBlockNumber = block.number;
            }
        }

        return toInternalBalance(newActual, newExempt, newBlockNumber);
    }

    /**
     * @dev Decreases an internal balance. In case `capped` was requested, it will be decreased as much as possible.
     * @return newBalance the new balance obtained after decreasing it
     * @return taxableAmount the amount that should be used to charge fees considering any existing exempts
     * @return decreasedAmount the amount the was actually deducted from the internal balance
     */
    function decrease(
        bytes32 balance,
        uint256 amount,
        bool capped,
        bool useExempt
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
        _require(capped || (currentActual >= amount), Errors.INSUFFICIENT_INTERNAL_BALANCE);

        uint256 decreased = Math.min(currentActual, amount);

        // Because of how decreased is constructed, we can skip checked arithmetic.
        uint256 newActual = currentActual - decreased;

        uint256 lastBlockNumber = blockNumber(balance);
        if (lastBlockNumber == block.number) {
            uint256 currentExempt = exempt(balance);

            uint256 exemptUsed = useExempt ? Math.min(currentExempt, decreased) : 0;
            uint256 newExempt = currentExempt - exemptUsed;
            uint256 taxableAmount = decreased - exemptUsed;

            // Note that it is possible for newExempt to be larger than newActual, if useExempt was false and
            // all non-exempt balance was used. This excess exempt balance remains as credit for future
            // withdrawals (but only in the same block!).
            bytes32 newBalance = toInternalBalance(newActual, newExempt, lastBlockNumber);
            return (newBalance, taxableAmount, decreased);
        } else {
            // Note that we consider the case where the current block number doesn't match the last one as a
            // regular decrease. We cannot handle negative exempt values, it would be like "credit" for potential
            // future ops in the same block.
            bytes32 newBalance = toInternalBalance(newActual, 0, 0);
            return (newBalance, decreased, decreased);
        }
    }

    /**
     * @dev Packs together actual and exempt amounts with a block number to create a balance value.
     * Critically, this also checks that both amounts can be packed together in the same slot.
     */
    function toInternalBalance(
        uint256 _actual,
        uint256 _exempt,
        uint256 _blockNumber
    ) internal pure returns (bytes32) {
        // We assume the block number will fit in a uint32 - this is expected to hold for at least a few decades.
        _require(_actual < 2**112 && _exempt < 2**112, Errors.INTERNAL_BALANCE_OVERFLOW);
        return _pack(_actual, _exempt, _blockNumber);
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
