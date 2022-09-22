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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";

import "../../contracts/lib/GradualValueChange.sol";
import "../../contracts/WeightedMath.sol";

import "../../contracts/test/MockManagedPoolTokenLib.sol";
import "../../contracts/managed/ManagedPoolTokenLib.sol";

contract ManagedPoolTokenLibTest is Test {
    uint256 private constant _START_DENORM_WEIGHT_OFFSET = 0;
    uint256 private constant _END_DENORM_WEIGHT_OFFSET = _START_DENORM_WEIGHT_OFFSET + _DENORM_WEIGHT_WIDTH;
    uint256 private constant _DECIMAL_DIFF_OFFSET = _END_DENORM_WEIGHT_OFFSET + _DENORM_WEIGHT_WIDTH;

    uint256 private constant _DENORM_WEIGHT_WIDTH = 64;
    uint256 private constant _DECIMAL_DIFF_WIDTH = 5;

    uint256 private constant _MIN_DENORM_WEIGHT_SUM = 0.02e18;
    uint256 private constant _MAX_DENORM_WEIGHT_SUM = 50e18;

    uint256 private constant _MAX_WEIGHT_REL_ERROR = 1e7; // 10^(-11)%

    MockManagedPoolTokenLib private mock;

    function setUp() external {
        mock = new MockManagedPoolTokenLib();
    }

    function clearWordAtPosition(
        bytes32 word,
        uint256 offset,
        uint256 bitLength
    ) internal returns (bytes32 clearedWord) {
        uint256 mask = (1 << bitLength) - 1;
        clearedWord = bytes32(uint256(word) & ~(mask << offset));
    }

    function assertOtherStateUnchanged(
        bytes32 oldPoolState,
        bytes32 newPoolState,
        uint256 offset,
        uint256 bitLength
    ) internal returns (bool) {
        bytes32 clearedOldState = clearWordAtPosition(oldPoolState, offset, bitLength);
        bytes32 clearedNewState = clearWordAtPosition(newPoolState, offset, bitLength);
        assertEq(clearedOldState, clearedNewState);
    }

    function testScalingFactor(bytes32 tokenState, uint8 decimals) external {
        decimals = uint8(bound(decimals, 0, 30));
        ERC20 token = new TestToken("Test", "TEST", decimals);

        if (decimals <= 18) {
            uint256 expectedScalingFactor = FixedPoint.ONE * 10**(18 - decimals);

            bytes32 newTokenState = mock.setTokenScalingFactor(tokenState, token);
            assertOtherStateUnchanged(tokenState, newTokenState, _DECIMAL_DIFF_OFFSET, _DECIMAL_DIFF_WIDTH);

            uint256 tokenScalingFactor = mock.getTokenScalingFactor(newTokenState);
            assertEq(tokenScalingFactor, expectedScalingFactor);
        } else {
            vm.expectRevert("BAL#001"); // SUB_OVERFLOW
            mock.setTokenScalingFactor(tokenState, token);
        }
    }

    function testWeightChangeFields(
        bytes32 tokenState,
        uint256 normalizedStartWeight,
        uint256 normalizedEndWeight,
        uint256 denormWeightSum
    ) external {
        normalizedStartWeight = bound(
            normalizedStartWeight,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        normalizedEndWeight = bound(
            normalizedEndWeight,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        denormWeightSum = bound(denormWeightSum, _MIN_DENORM_WEIGHT_SUM, _MAX_DENORM_WEIGHT_SUM);

        bytes32 newTokenState = mock.setTokenWeight(
            tokenState,
            normalizedStartWeight,
            normalizedEndWeight,
            denormWeightSum
        );
        assertOtherStateUnchanged(tokenState, newTokenState, _START_DENORM_WEIGHT_OFFSET, _DENORM_WEIGHT_WIDTH * 2);

        (uint256 recoveredStartWeight, uint256 recoveredEndWeight) = mock.getTokenStartAndEndWeights(
            newTokenState,
            denormWeightSum
        );

        assertApproxEqRel(recoveredStartWeight, normalizedStartWeight, _MAX_WEIGHT_REL_ERROR);
        assertApproxEqRel(recoveredEndWeight, normalizedEndWeight, _MAX_WEIGHT_REL_ERROR);
    }

    function testWeightInterpolation(
        bytes32 tokenState,
        uint256 normalizedStartWeight,
        uint256 normalizedEndWeight,
        uint32 startTime,
        uint32 endTime,
        uint32 now,
        uint256 denormWeightSum
    ) external {
        vm.warp(now);
        vm.assume(startTime <= endTime);

        normalizedStartWeight = bound(
            normalizedStartWeight,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        normalizedEndWeight = bound(
            normalizedEndWeight,
            WeightedMath._MIN_WEIGHT,
            FixedPoint.ONE - WeightedMath._MIN_WEIGHT
        );
        denormWeightSum = bound(denormWeightSum, _MIN_DENORM_WEIGHT_SUM, _MAX_DENORM_WEIGHT_SUM);

        bytes32 newTokenState = mock.setTokenWeight(
            tokenState,
            normalizedStartWeight,
            normalizedEndWeight,
            denormWeightSum
        );

        uint256 pctProgress = GradualValueChange.calculateValueChangeProgress(startTime, endTime);
        uint256 expectedInterpolatedWeight = GradualValueChange.interpolateValue(
            normalizedStartWeight,
            normalizedEndWeight,
            pctProgress
        );
        uint256 interpolatedWeight = mock.getTokenWeight(newTokenState, pctProgress, denormWeightSum);

        // We don't expect an exact equality due to the rounding errors introduced in the denormalization process.
        assertApproxEqRel(interpolatedWeight, expectedInterpolatedWeight, _MAX_WEIGHT_REL_ERROR);
    }

    function testInitializeToken(
        bytes32 tokenState,
        uint256 normalizedWeight,
        uint8 decimals,
        uint256 denormWeightSum
    ) external {
        normalizedWeight = bound(normalizedWeight, WeightedMath._MIN_WEIGHT, FixedPoint.ONE - WeightedMath._MIN_WEIGHT);
        denormWeightSum = bound(denormWeightSum, _MIN_DENORM_WEIGHT_SUM, _MAX_DENORM_WEIGHT_SUM);
        decimals = uint8(bound(decimals, 0, 30));

        ERC20 token = new TestToken("Test", "TEST", decimals);
        if (decimals <= 18) {
            bytes32 tokenState = mock.initializeTokenState(token, normalizedWeight, denormWeightSum);
            assertOtherStateUnchanged(
                bytes32(0),
                tokenState,
                _START_DENORM_WEIGHT_OFFSET,
                _DENORM_WEIGHT_WIDTH * 2 + _DECIMAL_DIFF_WIDTH
            );

            uint256 expectedScalingFactor = FixedPoint.ONE * 10**(18 - decimals);
            uint256 tokenScalingFactor = mock.getTokenScalingFactor(tokenState);
            assertEq(tokenScalingFactor, expectedScalingFactor);

            (uint256 startWeight, uint256 endWeight) = mock.getTokenStartAndEndWeights(tokenState, denormWeightSum);

            assertEq(startWeight, endWeight);
            assertApproxEqRel(startWeight, normalizedWeight, _MAX_WEIGHT_REL_ERROR);
        } else {
            vm.expectRevert("BAL#001"); // SUB_OVERFLOW
            mock.initializeTokenState(token, normalizedWeight, denormWeightSum);
        }
    }

    function testGetMinimumTokenEndWeight(
        uint256[40] memory normalizedWeightsFixed,
        uint256 arrayLength,
        uint256 denormWeightSum
    ) external {
        arrayLength = bound(arrayLength, 2, 40);

        IERC20[] memory tokens = new IERC20[](arrayLength);
        uint256[] memory normalizedWeights = new uint256[](arrayLength);
        for (uint256 i = 0; i < arrayLength; i++) {
            // The value of the tokens array is unimportant for testing purposes.
            // All that we require is that each element is unique.
            tokens[i] = IERC20(i);

            normalizedWeights[i] = bound(
                normalizedWeightsFixed[i],
                WeightedMath._MIN_WEIGHT,
                FixedPoint.ONE - WeightedMath._MIN_WEIGHT
            );
        }

        denormWeightSum = bound(denormWeightSum, _MIN_DENORM_WEIGHT_SUM, _MAX_DENORM_WEIGHT_SUM);

        uint256 minNormalizedWeight = type(uint256).max;
        for (uint256 i = 0; i < arrayLength; i++) {
            if (normalizedWeights[i] < minNormalizedWeight) {
                minNormalizedWeight = normalizedWeights[i];
            }
        }

        assertApproxEqRel(
            mock.getMinimumTokenEndWeight(tokens, normalizedWeights, denormWeightSum),
            minNormalizedWeight,
            _MAX_WEIGHT_REL_ERROR
        );
    }
}
