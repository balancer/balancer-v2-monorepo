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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "../lib/GradualValueChange.sol";
import "../lib/ValueCompression.sol";

library LiquidityBootstrappingPoolStorageLib {
    using WordCodec for bytes32;
    using ValueCompression for uint256;

    // LBPs often involve only two tokens - we support up to four since we're able to pack the entire config in a single
    // storage slot.
    uint256 internal constant _MAX_LBP_TOKENS = 4;

    // For gas optimization, store start/end weights and timestamps in one bytes32
    // Start weights need to be high precision, since restarting the update resets them to "spot"
    // values. Target end weights do not need as much precision.
    // [      64 bits     |      124 bits      |     32 bits   |     32 bits     |  2 bits  |  1 bit   |     1 bit    ]
    // [ 4x16 end weights | 4x31 start weights | end timestamp | start timestamp | not used | recovery | swap enabled ]
    // |MSB                                                                                                        LSB|

    // Offsets for data elements in bitmap
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

    // Getters

    /**
     * @notice Return whether swaps are enabled or not for the given pool.
     */
    function getSwapEnabled(bytes32 poolState) internal pure returns (bool) {
        return poolState.decodeBool(_SWAP_ENABLED_OFFSET);
    }

    /**
     * @notice Returns whether the pool is in Recovery Mode.
     */
    function getRecoveryMode(bytes32 poolState) internal pure returns (bool) {
        return poolState.decodeBool(_RECOVERY_MODE_BIT_OFFSET);
    }

    /**
     * @dev Return start time, end time, and endWeights as an array.
     * Current weights should be retrieved via `getNormalizedWeights()`.
     */
    function getGradualWeightUpdateParams(bytes32 poolState, uint256 totalTokens)
        internal
        pure
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256[] memory startWeights,
            uint256[] memory endWeights
        )
    {
        startTime = poolState.decodeUint(_START_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH);
        endTime = poolState.decodeUint(_END_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH);

        startWeights = new uint256[](totalTokens);
        endWeights = new uint256[](totalTokens);

        for (uint256 i = 0; i < totalTokens; i++) {
            startWeights[i] = poolState
                .decodeUint(_START_WEIGHT_OFFSET + i * _START_WEIGHT_BIT_LENGTH, _START_WEIGHT_BIT_LENGTH)
                .decompress(_START_WEIGHT_BIT_LENGTH);
            endWeights[i] = poolState
                .decodeUint(_END_WEIGHT_OFFSET + i * _END_WEIGHT_BIT_LENGTH, _END_WEIGHT_BIT_LENGTH)
                .decompress(_END_WEIGHT_BIT_LENGTH);
        }
    }

    function getWeightChangeProgress(bytes32 poolState) internal view returns (uint256) {
        uint256 startTime = poolState.decodeUint(_START_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH);
        uint256 endTime = poolState.decodeUint(_END_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH);

        return GradualValueChange.calculateValueChangeProgress(startTime, endTime);
    }

    function getNormalizedWeightByIndex(
        bytes32 poolState,
        uint256 index,
        uint256 pctProgress
    ) internal pure returns (uint256) {
        uint256 startWeight = poolState
            .decodeUint(_START_WEIGHT_OFFSET + index * _START_WEIGHT_BIT_LENGTH, _START_WEIGHT_BIT_LENGTH)
            .decompress(_START_WEIGHT_BIT_LENGTH);
        uint256 endWeight = poolState
            .decodeUint(_END_WEIGHT_OFFSET + index * _END_WEIGHT_BIT_LENGTH, _END_WEIGHT_BIT_LENGTH)
            .decompress(_END_WEIGHT_BIT_LENGTH);

        return GradualValueChange.interpolateValue(startWeight, endWeight, pctProgress);
    }

    // Setters

    function setSwapEnabled(bytes32 poolState, bool swapEnabled) internal pure returns (bytes32) {
        return poolState.insertBool(swapEnabled, _SWAP_ENABLED_OFFSET);
    }

    function setRecoveryMode(bytes32 poolState, bool enabled) internal pure returns (bytes32) {
        return poolState.insertBool(enabled, _RECOVERY_MODE_BIT_OFFSET);
    }

    function setNormalizedWeights(
        bytes32 poolState,
        uint256 startTime,
        uint256 endTime,
        uint256[] memory newStartWeights,
        uint256[] memory newEndWeights
    ) internal pure returns (bytes32) {
        poolState = poolState.insertUint(startTime, _START_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH).insertUint(
            endTime,
            _END_TIME_OFFSET,
            _TIMESTAMP_BIT_LENGTH
        );

        // This performs no checks on the validity of the weights, assuming these are done externally.
        // In particular, we assume that newStartWeights.length == newEndWeights.length, and all
        // newEndWeights are above the minimum.
        //
        // We do not need to check that `newStartWeights <= _MAX_LBP_TOKENS` as the `_MAX_LBP_TOKENS + 1`th token will
        // attempt to write past the 256th bit of `poolState`, resulting in `WordCodec` reverting.
        for (uint256 i = 0; i < newStartWeights.length; i++) {
            poolState = poolState
                .insertUint(
                newStartWeights[i].compress(_START_WEIGHT_BIT_LENGTH),
                _START_WEIGHT_OFFSET + i * _START_WEIGHT_BIT_LENGTH,
                _START_WEIGHT_BIT_LENGTH
            )
                .insertUint(
                newEndWeights[i].compress(_END_WEIGHT_BIT_LENGTH),
                _END_WEIGHT_OFFSET + i * _END_WEIGHT_BIT_LENGTH,
                _END_WEIGHT_BIT_LENGTH
            );
        }
        return poolState;
    }
}
