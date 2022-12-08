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

contract MaliciousQueryReverter {
    enum RevertType { DoNotRevert, NonMalicious, MaliciousSwapQuery, MaliciousJoinExitQuery }

    RevertType public revertType = RevertType.DoNotRevert;

    function setRevertType(RevertType newRevertType) external {
        revertType = newRevertType;
    }

    function maybeRevertMaliciously() public view {
        if (revertType == RevertType.NonMalicious) {
            revert("NON_MALICIOUS_REVERT");
        } else if (revertType == RevertType.MaliciousSwapQuery) {
            spoofSwapQueryRevert();
        } else if (revertType == RevertType.MaliciousJoinExitQuery) {
            spoofJoinExitQueryRevert();
        } else {
            // Do nothing
        }
    }

    function spoofJoinExitQueryRevert() public pure {
        uint256[] memory tokenAmounts = new uint256[](2);
        tokenAmounts[0] = 1;
        tokenAmounts[1] = 2;

        uint256 bptAmount = 420;

        // solhint-disable-next-line no-inline-assembly
        assembly {
            // We will return a raw representation of `bptAmount` and `tokenAmounts` in memory, which is composed of
            // a 32-byte uint256, followed by a 32-byte for the array length, and finally the 32-byte uint256 values
            // Because revert expects a size in bytes, we multiply the array length (stored at `tokenAmounts`) by 32
            let size := mul(mload(tokenAmounts), 32)

            // We store the `bptAmount` in the previous slot to the `tokenAmounts` array. We can make sure there
            // will be at least one available slot due to how the memory scratch space works.
            // We can safely overwrite whatever is stored in this slot as we will revert immediately after that.
            let start := sub(tokenAmounts, 0x20)
            mstore(start, bptAmount)

            // We send one extra value for the error signature "QueryError(uint256,uint256[])" which is 0x43adbafb
            // We use the previous slot to `bptAmount`.
            mstore(sub(start, 0x20), 0x0000000000000000000000000000000000000000000000000000000043adbafb)
            start := sub(start, 0x04)

            // When copying from `tokenAmounts` into returndata, we copy the additional 68 bytes to also return
            // the `bptAmount`, the array's length, and the error signature.
            revert(start, add(size, 68))
        }
    }

    function spoofSwapQueryRevert() public pure {
        int256[] memory deltas = new int256[](2);
        deltas[0] = 1;
        deltas[1] = 2;

        // solhint-disable-next-line no-inline-assembly
        assembly {
            // We will return a raw representation of the array in memory, which is composed of a 32 byte length,
            // followed by the 32 byte int256 values. Because revert expects a size in bytes, we multiply the array
            // length (stored at `deltas`) by 32.
            let size := mul(mload(deltas), 32)

            // We send one extra value for the error signature "QueryError(int256[])" which is 0xfa61cc12.
            // We store it in the previous slot to the `deltas` array. We know there will be at least one available
            // slot due to how the memory scratch space works.
            // We can safely overwrite whatever is stored in this slot as we will revert immediately after that.
            mstore(sub(deltas, 0x20), 0x00000000000000000000000000000000000000000000000000000000fa61cc12)
            let start := sub(deltas, 0x04)

            // When copying from `deltas` into returndata, we copy an additional 36 bytes to also return the array's
            // length and the error signature.
            revert(start, add(size, 36))
        }
    }
}
