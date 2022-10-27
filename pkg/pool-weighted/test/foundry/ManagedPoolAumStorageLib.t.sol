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

import { Test } from "forge-std/Test.sol";

import "../../contracts/managed/ManagedPoolAumStorageLib.sol";

contract ManagedPoolAumStorageLibTest is Test {
    uint256 private constant _AUM_FEE_PERCENTAGE_OFFSET = 0;
    uint256 private constant _LAST_COLLECTION_TIMESTAMP_OFFSET = _AUM_FEE_PERCENTAGE_OFFSET + _AUM_FEE_PCT_WIDTH;

    uint256 private constant _TIMESTAMP_WIDTH = 32;
    uint256 private constant _AUM_FEE_PCT_WIDTH = 60;

    uint256 private constant _MAX_AUM_FEE = (1 << _AUM_FEE_PCT_WIDTH) - 1;
    uint256 private constant _MAX_TIMESTAMP = (1 << _TIMESTAMP_WIDTH) - 1;

    function clearWordAtPosition(
        bytes32 word,
        uint256 offset,
        uint256 bitLength
    ) internal returns (bytes32 clearedWord) {
        uint256 mask = (1 << bitLength) - 1;
        clearedWord = bytes32(uint256(word) & ~(mask << offset));
    }

    function assertOtherStateUnchanged(
        bytes32 oldAumState,
        bytes32 newAumState,
        uint256 offset,
        uint256 bitLength
    ) internal returns (bool) {
        bytes32 clearedOldState = clearWordAtPosition(oldAumState, offset, bitLength);
        bytes32 clearedNewState = clearWordAtPosition(newAumState, offset, bitLength);
        assertEq(clearedOldState, clearedNewState);
    }

    function testSetAumFeePercentage(bytes32 aumState, uint256 expectedAumFeePercentage) public {
        vm.assume(expectedAumFeePercentage <= _MAX_AUM_FEE);

        bytes32 newAumState = ManagedPoolAumStorageLib.setAumFeePercentage(aumState, expectedAumFeePercentage);
        assertOtherStateUnchanged(aumState, newAumState, _AUM_FEE_PERCENTAGE_OFFSET, _AUM_FEE_PCT_WIDTH);

        (uint256 actualAumFeePercentage, ) = ManagedPoolAumStorageLib.getAumFeeFields(newAumState);
        assertEq(actualAumFeePercentage, expectedAumFeePercentage);
    }

    function testSetLastCollectionTimestamp(bytes32 aumState, uint256 expectedLastCollectionTimestamp) public {
        vm.assume(expectedLastCollectionTimestamp <= _MAX_TIMESTAMP);

        bytes32 newAumState = ManagedPoolAumStorageLib.setLastCollectionTimestamp(
            aumState,
            expectedLastCollectionTimestamp
        );
        assertOtherStateUnchanged(aumState, newAumState, _LAST_COLLECTION_TIMESTAMP_OFFSET, _TIMESTAMP_WIDTH);

        (, uint256 actualLastCollectionTimestamp) = ManagedPoolAumStorageLib.getAumFeeFields(newAumState);
        assertEq(actualLastCollectionTimestamp, expectedLastCollectionTimestamp);
    }
}
