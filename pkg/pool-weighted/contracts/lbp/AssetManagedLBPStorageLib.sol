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

library AssetManagedLBPStorageLib {
    using WordCodec for bytes32;
    using ValueCompression for uint256;

    // Asset Managed LBPs always have two tokens.
    uint256 private constant _LBP_TOKENS = 2;

    // For gas optimization, store start/end weights and timestamps in one bytes32
    // Start weights need to be high precision, since restarting the update resets them to "spot" values.
    // Cache the protocol swap fee in the top 62 bits. 1e18 ~ 60 bits, so it will fit.
    // [   62 bits     |  1 bit   |   1 bit      |    32 bits    |     32 bits     |    64 bits    |    64 bits      ]
    // [ protocol fee  | recovery | swap enabled | end timestamp | start timestamp | 2x32 end wgts | 2x32 start wgts ]
    // |MSB                                                                                                       LSB|

    // Offsets for data elements in _poolState
    uint256 private constant _START_WEIGHT_OFFSET = 0;
    uint256 private constant _END_WEIGHT_OFFSET = _START_WEIGHT_OFFSET + _WEIGHT_BIT_LENGTH * _LBP_TOKENS;
    uint256 private constant _START_TIME_OFFSET = _END_WEIGHT_OFFSET + _WEIGHT_BIT_LENGTH * _LBP_TOKENS;
    uint256 private constant _END_TIME_OFFSET = _START_TIME_OFFSET + _TIMESTAMP_BIT_LENGTH;
    uint256 private constant _SWAP_ENABLED_OFFSET = _END_TIME_OFFSET + _TIMESTAMP_BIT_LENGTH;
    uint256 private constant _RECOVERY_MODE_BIT_OFFSET = _SWAP_ENABLED_OFFSET + 1;
    uint256 private constant _PROTOCOL_SWAP_FEE_OFFSET = _RECOVERY_MODE_BIT_OFFSET + 1;

    uint256 private constant _WEIGHT_BIT_LENGTH = 32;
    uint256 private constant _TIMESTAMP_BIT_LENGTH = 32;
    uint256 private constant _PROTOCOL_SWAP_FEE_BIT_LENGTH = 62;

    // Pool Permissions

    /**
     * @notice Return whether swaps are enabled or not for the given pool.
     */
    function getSwapEnabled(bytes32 poolState) internal pure returns (bool) {
        return poolState.decodeBool(_SWAP_ENABLED_OFFSET);
    }

    function setSwapEnabled(bytes32 poolState, bool swapEnabled) internal pure returns (bytes32) {
        return poolState.insertBool(swapEnabled, _SWAP_ENABLED_OFFSET);
    }

    // Weights

    /**
     * @dev Return start time, end time, and endWeights as an array.
     * Current weights should be retrieved via `getNormalizedWeights()`.
     */
    function getGradualWeightUpdateParams(bytes32 poolState)
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

        startWeights = new uint256[](_LBP_TOKENS);
        endWeights = new uint256[](_LBP_TOKENS);

        for (uint256 i = 0; i < _LBP_TOKENS; i++) {
            startWeights[i] = poolState
                .decodeUint(_START_WEIGHT_OFFSET + i * _WEIGHT_BIT_LENGTH, _WEIGHT_BIT_LENGTH)
                .decompress(_WEIGHT_BIT_LENGTH);
            endWeights[i] = poolState
                .decodeUint(_END_WEIGHT_OFFSET + i * _WEIGHT_BIT_LENGTH, _WEIGHT_BIT_LENGTH)
                .decompress(_WEIGHT_BIT_LENGTH);
        }
    }

    function getNormalizedWeightByIndex(uint256 index, bytes32 poolState) internal view returns (uint256) {
        uint256 startWeight = poolState
            .decodeUint(_START_WEIGHT_OFFSET + index * _WEIGHT_BIT_LENGTH, _WEIGHT_BIT_LENGTH)
            .decompress(_WEIGHT_BIT_LENGTH);
        uint256 endWeight = poolState
            .decodeUint(_END_WEIGHT_OFFSET + index * _WEIGHT_BIT_LENGTH, _WEIGHT_BIT_LENGTH)
            .decompress(_WEIGHT_BIT_LENGTH);

        uint256 pctProgress = getWeightChangeProgress(poolState);

        return GradualValueChange.interpolateValue(startWeight, endWeight, pctProgress);
    }

    function getWeightChangeProgress(bytes32 poolState) internal view returns (uint256) {
        uint256 startTime = poolState.decodeUint(_START_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH);
        uint256 endTime = poolState.decodeUint(_END_TIME_OFFSET, _TIMESTAMP_BIT_LENGTH);

        return GradualValueChange.calculateValueChangeProgress(startTime, endTime);
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
                newStartWeights[i].compress(_WEIGHT_BIT_LENGTH),
                _START_WEIGHT_OFFSET + i * _WEIGHT_BIT_LENGTH,
                _WEIGHT_BIT_LENGTH
            )
                .insertUint(
                newEndWeights[i].compress(_WEIGHT_BIT_LENGTH),
                _END_WEIGHT_OFFSET + i * _WEIGHT_BIT_LENGTH,
                _WEIGHT_BIT_LENGTH
            );
        }

        return poolState;
    }

    // Protocol Fees

    function getCachedProtocolSwapFee(bytes32 poolState) internal pure returns (uint256) {
        return
            poolState.decodeUint(_PROTOCOL_SWAP_FEE_OFFSET, _PROTOCOL_SWAP_FEE_BIT_LENGTH).decompress(
                _PROTOCOL_SWAP_FEE_BIT_LENGTH
            );
    }

    function setCachedProtocolSwapFee(bytes32 poolState, uint256 protocolSwapFee) internal pure returns (bytes32) {
        return
            poolState.insertUint(
                protocolSwapFee.compress(_PROTOCOL_SWAP_FEE_BIT_LENGTH),
                _PROTOCOL_SWAP_FEE_OFFSET,
                _PROTOCOL_SWAP_FEE_BIT_LENGTH
            );
    }

    // Recovery Mode

    /**
     * @notice Returns whether the pool is in Recovery Mode.
     */
    function getRecoveryMode(bytes32 poolState) internal pure returns (bool) {
        return poolState.decodeBool(_RECOVERY_MODE_BIT_OFFSET);
    }

    function setRecoveryMode(bytes32 poolState, bool enabled) internal pure returns (bytes32) {
        return poolState.insertBool(enabled, _RECOVERY_MODE_BIT_OFFSET);
    }
}
