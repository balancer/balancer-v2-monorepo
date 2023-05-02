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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";

import "../../contracts/lib/GradualValueChange.sol";
import "../../contracts/WeightedMath.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodecHelpers.sol";

import "../../contracts/test/MockManagedPoolTokenStorageLib.sol";

contract ManagedPoolTokenStorageLibTest is Test {
    uint256 private constant _START_NORM_WEIGHT_OFFSET = 0;
    uint256 private constant _END_NORM_WEIGHT_OFFSET = _START_NORM_WEIGHT_OFFSET + _NORM_WEIGHT_WIDTH;
    uint256 private constant _DECIMAL_DIFF_OFFSET = _END_NORM_WEIGHT_OFFSET + _NORM_WEIGHT_WIDTH;

    uint256 private constant _NORM_WEIGHT_WIDTH = 64;
    uint256 private constant _DECIMAL_DIFF_WIDTH = 5;

    MockManagedPoolTokenStorageLib private mock;

    function setUp() external {
        mock = new MockManagedPoolTokenStorageLib();
    }

    function testScalingFactor(bytes32 tokenState, uint8 decimals) external {
        decimals = uint8(bound(decimals, uint256(0), 30));
        ERC20 token = new TestToken("Test", "TEST", decimals);

        if (decimals <= 18) {
            uint256 expectedScalingFactor = FixedPoint.ONE * 10**(18 - decimals);

            bytes32 newTokenState = mock.setTokenScalingFactor(tokenState, token);
            assertTrue(WordCodecHelpers.isOtherStateUnchanged(tokenState, newTokenState, _DECIMAL_DIFF_OFFSET, _DECIMAL_DIFF_WIDTH));

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
        uint256 normalizedEndWeight
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

        bytes32 newTokenState = mock.setTokenWeight(tokenState, normalizedStartWeight, normalizedEndWeight);

        assertTrue(WordCodecHelpers.isOtherStateUnchanged(tokenState, newTokenState, _START_NORM_WEIGHT_OFFSET, _NORM_WEIGHT_WIDTH * 2));

        (uint256 recoveredStartWeight, uint256 recoveredEndWeight) = mock.getTokenStartAndEndWeights(newTokenState);

        assertEq(recoveredStartWeight, normalizedStartWeight);
        assertEq(recoveredEndWeight, normalizedEndWeight);
    }

    function testWeightInterpolation(
        bytes32 tokenState,
        uint256 normalizedStartWeight,
        uint256 normalizedEndWeight,
        uint32 startTime,
        uint32 endTime,
        uint32 currentTime
    ) external {
        vm.warp(currentTime);
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

        bytes32 newTokenState = mock.setTokenWeight(tokenState, normalizedStartWeight, normalizedEndWeight);

        uint256 pctProgress = GradualValueChange.calculateValueChangeProgress(startTime, endTime);
        uint256 expectedInterpolatedWeight = GradualValueChange.interpolateValue(
            normalizedStartWeight,
            normalizedEndWeight,
            pctProgress
        );
        uint256 interpolatedWeight = mock.getTokenWeight(newTokenState, pctProgress);

        // We don't expect an exact equality due to the rounding errors in the interpolation.
        assertApproxEqAbs(interpolatedWeight, expectedInterpolatedWeight, 1);
    }

    function testInitializeToken(uint256 normalizedWeight, uint8 decimals) external {
        normalizedWeight = bound(normalizedWeight, WeightedMath._MIN_WEIGHT, FixedPoint.ONE - WeightedMath._MIN_WEIGHT);
        decimals = uint8(bound(decimals, uint256(0), 30));

        ERC20 token = new TestToken("Test", "TEST", decimals);
        if (decimals <= 18) {
            bytes32 tokenState = mock.initializeTokenState(token, normalizedWeight);
            assertTrue(WordCodecHelpers.isOtherStateUnchanged(
                bytes32(0),
                tokenState,
                _START_NORM_WEIGHT_OFFSET,
                _NORM_WEIGHT_WIDTH * 2 + _DECIMAL_DIFF_WIDTH
            ));

            uint256 expectedScalingFactor = FixedPoint.ONE * 10**(18 - decimals);
            uint256 tokenScalingFactor = mock.getTokenScalingFactor(tokenState);
            assertEq(tokenScalingFactor, expectedScalingFactor);

            (uint256 startWeight, uint256 endWeight) = mock.getTokenStartAndEndWeights(tokenState);

            assertEq(startWeight, endWeight);
            assertEq(startWeight, normalizedWeight);
        } else {
            vm.expectRevert("BAL#001"); // SUB_OVERFLOW
            mock.initializeTokenState(token, normalizedWeight);
        }
    }
}
