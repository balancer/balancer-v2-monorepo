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
pragma experimental ABIEncoderV2;

import { Test } from "forge-std/Test.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodecHelpers.sol";

import "../../contracts/managed/ManagedPoolStorageLib.sol";

contract ManagedPoolStorageLibTest is Test {
    uint256 private constant _WEIGHT_START_TIME_OFFSET = 0;
    uint256 private constant _WEIGHT_END_TIME_OFFSET = _WEIGHT_START_TIME_OFFSET + _TIMESTAMP_WIDTH;
    uint256 private constant _SWAP_FEE_START_TIME_OFFSET = _WEIGHT_END_TIME_OFFSET + _TIMESTAMP_WIDTH;
    uint256 private constant _SWAP_FEE_END_TIME_OFFSET = _SWAP_FEE_START_TIME_OFFSET + _TIMESTAMP_WIDTH;
    uint256 private constant _SWAP_FEE_START_PCT_OFFSET = _SWAP_FEE_END_TIME_OFFSET + _TIMESTAMP_WIDTH;
    uint256 private constant _SWAP_FEE_END_PCT_OFFSET = _SWAP_FEE_START_PCT_OFFSET + _SWAP_FEE_PCT_WIDTH;
    uint256 private constant _SWAP_ENABLED_OFFSET = _SWAP_FEE_END_PCT_OFFSET + _SWAP_FEE_PCT_WIDTH;
    uint256 private constant _MUST_ALLOWLIST_LPS_OFFSET = _SWAP_ENABLED_OFFSET + 1;
    uint256 private constant _RECOVERY_MODE_OFFSET = _MUST_ALLOWLIST_LPS_OFFSET + 1;
    uint256 private constant _JOIN_EXIT_ENABLED_OFFSET = _RECOVERY_MODE_OFFSET + 1;

    uint256 private constant _TIMESTAMP_WIDTH = 32;
    uint256 private constant _SWAP_FEE_PCT_WIDTH = 62;

    uint256 private constant _MAX_SWAP_FEE = (1 << _SWAP_FEE_PCT_WIDTH) - 1;

    function testSetJoinExitEnabled(bytes32 poolState, bool enabled) public {
        bytes32 newPoolState = ManagedPoolStorageLib.setJoinExitEnabled(poolState, enabled);
        assertTrue(WordCodecHelpers.isOtherStateUnchanged(poolState, newPoolState, _JOIN_EXIT_ENABLED_OFFSET, 1));

        assertEq(ManagedPoolStorageLib.getJoinExitEnabled(newPoolState), enabled);
    }

    function testSetRecoveryMode(bytes32 poolState, bool enabled) public {
        bytes32 newPoolState = ManagedPoolStorageLib.setRecoveryModeEnabled(poolState, enabled);
        assertTrue(WordCodecHelpers.isOtherStateUnchanged(poolState, newPoolState, _RECOVERY_MODE_OFFSET, 1));

        assertEq(ManagedPoolStorageLib.getRecoveryModeEnabled(newPoolState), enabled);
    }

    function testSwapEnabled(bytes32 poolState, bool enabled) public {
        bytes32 newPoolState = ManagedPoolStorageLib.setSwapEnabled(poolState, enabled);
        assertTrue(WordCodecHelpers.isOtherStateUnchanged(poolState, newPoolState, _SWAP_ENABLED_OFFSET, 1));

        assertEq(ManagedPoolStorageLib.getSwapEnabled(newPoolState), enabled);
    }

    function testLPAllowlistEnabled(bytes32 poolState, bool enabled) public {
        bytes32 newPoolState = ManagedPoolStorageLib.setLPAllowlistEnabled(poolState, enabled);
        assertTrue(WordCodecHelpers.isOtherStateUnchanged(poolState, newPoolState, _MUST_ALLOWLIST_LPS_OFFSET, 1));

        assertEq(ManagedPoolStorageLib.getLPAllowlistEnabled(newPoolState), enabled);
    }

    function testWeightChangeFields(
        bytes32 poolState,
        uint32 startTime,
        uint32 endTime
    ) public {
        bytes32 newPoolState = ManagedPoolStorageLib.setWeightChangeData(poolState, startTime, endTime);
        assertTrue(WordCodecHelpers.isOtherStateUnchanged(poolState, newPoolState, _WEIGHT_START_TIME_OFFSET, _TIMESTAMP_WIDTH * 2));

        (uint256 actualStartTime, uint256 actualEndTime) = ManagedPoolStorageLib.getWeightChangeFields(newPoolState);
        assertEq(actualStartTime, startTime);
        assertEq(actualEndTime, endTime);
    }

    function testWeightChangeProgress(
        bytes32 poolState,
        uint32 startTime,
        uint32 endTime,
        uint32 currentTime
    ) public {
        vm.warp(currentTime);
        vm.assume(startTime <= endTime);

        bytes32 newPoolState = ManagedPoolStorageLib.setWeightChangeData(poolState, startTime, endTime);
        uint256 weightChangeProgress = ManagedPoolStorageLib.getGradualWeightChangeProgress(newPoolState);

        if (currentTime >= endTime) {
            assertEq(weightChangeProgress, FixedPoint.ONE);
        } else if (currentTime <= startTime) {
            assertEq(weightChangeProgress, 0);
        } else {
            uint256 expectedWeightChangeProgress = FixedPoint.divDown(currentTime - startTime, endTime - startTime);
            assertEq(weightChangeProgress, expectedWeightChangeProgress);
        }
    }

    function testSwapFeeData(
        bytes32 poolState,
        uint32 startTime,
        uint32 endTime,
        uint64 startSwapFeePercentage,
        uint64 endSwapFeePercentage
    ) public {
        vm.assume(startSwapFeePercentage < _MAX_SWAP_FEE);
        vm.assume(endSwapFeePercentage < _MAX_SWAP_FEE);

        bytes32 newPoolState = ManagedPoolStorageLib.setSwapFeeData(
            poolState,
            startTime,
            endTime,
            startSwapFeePercentage,
            endSwapFeePercentage
        );
        assertTrue(WordCodecHelpers.isOtherStateUnchanged(
            poolState,
            newPoolState,
            _SWAP_FEE_START_TIME_OFFSET,
            _TIMESTAMP_WIDTH * 2 + _SWAP_FEE_PCT_WIDTH * 2
        ));

        (
            uint256 actualStartTime,
            uint256 actualEndTime,
            uint256 actualStartSwapFeePercentage,
            uint256 actualEndSwapFeePercentage
        ) = ManagedPoolStorageLib.getSwapFeeFields(newPoolState);

        assertEq(actualStartTime, startTime);
        assertEq(actualEndTime, endTime);
        assertEq(actualStartSwapFeePercentage, startSwapFeePercentage);
        assertEq(actualEndSwapFeePercentage, endSwapFeePercentage);
    }

    function testSwapFeePercentage(
        bytes32 poolState,
        uint32 startTime,
        uint32 endTime,
        uint64 startSwapFeePercentage,
        uint64 endSwapFeePercentage,
        uint32 currentTime
    ) public {
        vm.warp(currentTime);
        vm.assume(startTime <= endTime);
        vm.assume(startSwapFeePercentage <= _MAX_SWAP_FEE);
        vm.assume(endSwapFeePercentage <= _MAX_SWAP_FEE);

        bytes32 newPoolState = ManagedPoolStorageLib.setSwapFeeData(
            poolState,
            startTime,
            endTime,
            startSwapFeePercentage,
            endSwapFeePercentage
        );
        uint256 swapFeePercentage = ManagedPoolStorageLib.getSwapFeePercentage(newPoolState);

        if (currentTime >= endTime) {
            assertEq(swapFeePercentage, endSwapFeePercentage);
        } else if (currentTime <= startTime) {
            assertEq(swapFeePercentage, startSwapFeePercentage);
        } else {
            uint256 expectedSwapFeeChangeProgress = FixedPoint.divDown(currentTime - startTime, endTime - startTime);
            if (endSwapFeePercentage >= startSwapFeePercentage) {
                uint256 delta = FixedPoint.mulDown(
                    endSwapFeePercentage - startSwapFeePercentage,
                    expectedSwapFeeChangeProgress
                );
                assertEq(swapFeePercentage, startSwapFeePercentage + delta);
            } else {
                uint256 delta = FixedPoint.mulDown(
                    startSwapFeePercentage - endSwapFeePercentage,
                    expectedSwapFeeChangeProgress
                );
                assertEq(swapFeePercentage, startSwapFeePercentage - delta);
            }
        }
    }
}
