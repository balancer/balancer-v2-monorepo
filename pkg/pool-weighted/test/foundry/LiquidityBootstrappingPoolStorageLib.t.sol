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

import "../../contracts/WeightedMath.sol";

import "../../contracts/test/MockLiquidityBootstrappingPoolStorageLib.sol";

contract LiquidityBootstrappingPoolStorageLibTest is Test {
    uint256 internal constant _MAX_LBP_TOKENS = 4;

    uint256 private constant _SWAP_ENABLED_OFFSET = 0;
    uint256 private constant _RECOVERY_MODE_BIT_OFFSET = 1;
    uint256 private constant _START_TIME_OFFSET = _RECOVERY_MODE_BIT_OFFSET + 1 + _UNUSED_BITS;
    uint256 private constant _END_TIME_OFFSET = _START_TIME_OFFSET + _TIMESTAMP_BIT_LENGTH;
    uint256 private constant _START_WEIGHT_OFFSET = _END_TIME_OFFSET + _TIMESTAMP_BIT_LENGTH;
    uint256 private constant _END_WEIGHT_OFFSET = _START_WEIGHT_OFFSET + _MAX_LBP_TOKENS * _START_WEIGHT_BIT_LENGTH;

    uint256 private constant _START_WEIGHT_BIT_LENGTH = 31;
    uint256 private constant _END_WEIGHT_BIT_LENGTH = 16;
    uint256 private constant _TIMESTAMP_BIT_LENGTH = 32;
    uint256 private constant _UNUSED_BITS = 2;

    MockLiquidityBootstrappingPoolStorageLib private mock;

    function setUp() external {
        mock = new MockLiquidityBootstrappingPoolStorageLib();
    }

    function testSetRecoveryMode(bytes32 poolState, bool enabled) external {
        bytes32 newPoolState = mock.setRecoveryMode(poolState, enabled);
        assertTrue(WordCodecHelpers.isOtherStateUnchanged(poolState, newPoolState, _RECOVERY_MODE_BIT_OFFSET, 1));

        assertEq(mock.getRecoveryMode(newPoolState), enabled);
    }

    function testSwapEnabled(bytes32 poolState, bool enabled) external {
        bytes32 newPoolState = mock.setSwapEnabled(poolState, enabled);
        assertTrue(WordCodecHelpers.isOtherStateUnchanged(poolState, newPoolState, _SWAP_ENABLED_OFFSET, 1));

        assertEq(mock.getSwapEnabled(newPoolState), enabled);
    }

    function testWeightChangeFields(
        bytes32 poolState,
        uint32 startTime,
        uint32 endTime,
        uint256[6] memory newStartWeightsFixed,
        uint256[6] memory newEndWeightsFixed,
        uint256 numTokens
    ) external {
        numTokens = bound(numTokens, 2, 6);

        uint256[] memory newStartWeights = new uint256[](numTokens);
        uint256[] memory newEndWeights = new uint256[](numTokens);
        for (uint256 i = 0; i < numTokens; i++) {
            // We don't really care that the weights are normalized as a whole, just that any reasonable value can be stored.
            newStartWeights[i] = bound(
                newStartWeightsFixed[i],
                WeightedMath._MIN_WEIGHT,
                FixedPoint.ONE - WeightedMath._MIN_WEIGHT
            );
            newEndWeights[i] = bound(
                newEndWeightsFixed[i],
                WeightedMath._MIN_WEIGHT,
                FixedPoint.ONE - WeightedMath._MIN_WEIGHT
            );
        }

        if (numTokens > _MAX_LBP_TOKENS) {
            vm.expectRevert("BAL#100"); // OUT_OF_BOUNDS
            mock.setNormalizedWeights(poolState, startTime, endTime, newStartWeights, newEndWeights);
        } else {
            bytes32 newPoolState = mock.setNormalizedWeights(
                poolState,
                startTime,
                endTime,
                newStartWeights,
                newEndWeights
            );

            assertTrue(
                WordCodecHelpers.isOtherStateUnchanged(
                    poolState,
                    newPoolState,
                    _START_TIME_OFFSET,
                    2 *
                        _TIMESTAMP_BIT_LENGTH +
                        _MAX_LBP_TOKENS *
                        _START_WEIGHT_BIT_LENGTH *
                        _MAX_LBP_TOKENS *
                        _END_WEIGHT_BIT_LENGTH
                )
            );

            (
                uint256 recoveredStartTime,
                uint256 recoveredEndTime,
                uint256[] memory recoveredStartWeights,
                uint256[] memory recoveredEndWeights
            ) = mock.getGradualWeightUpdateParams(newPoolState, numTokens);

            assertEq(recoveredStartTime, startTime);
            assertEq(recoveredEndTime, endTime);
            for (uint256 i = 0; i < numTokens; i++) {
                assertApproxEqRel(recoveredStartWeights[i], newStartWeights[i], 1e11);
                assertApproxEqRel(recoveredEndWeights[i], newEndWeights[i], 2e15);
            }
        }
    }
}
