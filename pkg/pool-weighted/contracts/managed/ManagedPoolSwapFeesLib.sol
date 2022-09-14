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

import "./ManagedPoolStorageLib.sol";

library ManagedPoolSwapFeesLib {
    // ManagedPool swap fees can change over time: these periods are expected to be long enough (e.g. days)
    // that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    event SwapFeePercentageChanged(uint256 swapFeePercentage);
    event GradualSwapFeeUpdateScheduled(
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    );

    uint256 private constant _MIN_SWAP_FEE_PERCENTAGE = 1e12; // 0.0001%

    // The swap fee cannot be 100%: calculations that divide by (1-fee) would revert with division by zero.
    // Swap fees close to 100% can still cause reverts when performing join/exit swaps, if the calculated fee
    // amounts exceed the pool's token balances in the Vault. 80% is a very high, but relatively safe maximum value.
    uint256 private constant _MAX_SWAP_FEE_PERCENTAGE = 80e16; // 80%

    function validateSwapFeePercentage(uint256 swapFeePercentage) internal pure {
        _require(swapFeePercentage >= _MIN_SWAP_FEE_PERCENTAGE, Errors.MIN_SWAP_FEE_PERCENTAGE);
        _require(swapFeePercentage <= _MAX_SWAP_FEE_PERCENTAGE, Errors.MAX_SWAP_FEE_PERCENTAGE);
    }

    /**
     * @notice Encodes a new swap fee percentage into the provided Pool state.
     * @dev The swap fee must be within the bounds set by MIN_SWAP_FEE_PERCENTAGE/MAX_SWAP_FEE_PERCENTAGE.
     * Emits the SwapFeePercentageChanged event.
     * @return poolState - The modified Pool state with the updated swap fee data. It's the responsiblity of the caller
     * to write this to storage so this value is persisted.
     */
    function setSwapFeePercentage(bytes32 poolState, uint256 swapFeePercentage) internal returns (bytes32) {
        validateSwapFeePercentage(swapFeePercentage);

        emit SwapFeePercentageChanged(swapFeePercentage);

        return
            ManagedPoolStorageLib.setSwapFeeData(
                poolState,
                block.timestamp,
                block.timestamp,
                swapFeePercentage,
                swapFeePercentage
            );
    }

    /**
     * @notice Encodes a gradual swap fee update into the provided Pool state.
     * @param startTime - The timestamp when the swap fee change will begin.
     * @param endTime - The timestamp when the swap fee change will end (must be >= startTime).
     * @param startSwapFeePercentage - The starting value for the swap fee change.
     * @param endSwapFeePercentage - The ending value for the swap fee change. If the current timestamp >= endTime,
     * `getSwapFeePercentage()` will return this value.
     * @return poolState - The modified Pool state with the updated swap fee data. It's the responsiblity of the caller
     * to write this to storage so this value is persisted.
     */
    function startGradualSwapFeeChange(
        bytes32 poolState,
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    ) internal returns (bytes32) {
        validateSwapFeePercentage(startSwapFeePercentage);
        validateSwapFeePercentage(endSwapFeePercentage);

        if (startSwapFeePercentage != ManagedPoolStorageLib.getSwapFeePercentage(poolState)) {
            poolState = setSwapFeePercentage(poolState, startSwapFeePercentage);
        }

        startTime = GradualValueChange.resolveStartTime(startTime, endTime);

        emit GradualSwapFeeUpdateScheduled(startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);

        return
            ManagedPoolStorageLib.setSwapFeeData(
                poolState,
                startTime,
                endTime,
                startSwapFeePercentage,
                endSwapFeePercentage
            );
    }
}
