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

abstract contract ManagedPoolSwapFees {
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

    function _getMinSwapFeePercentage() internal pure returns (uint256) {
        return _MIN_SWAP_FEE_PERCENTAGE;
    }

    function _getMaxSwapFeePercentage() internal pure returns (uint256) {
        return _MAX_SWAP_FEE_PERCENTAGE;
    }

    function _validateSwapFeePercentage(uint256 swapFeePercentage) internal pure {
        _require(swapFeePercentage >= _getMinSwapFeePercentage(), Errors.MIN_SWAP_FEE_PERCENTAGE);
        _require(swapFeePercentage <= _getMaxSwapFeePercentage(), Errors.MAX_SWAP_FEE_PERCENTAGE);
    }

    function _setSwapFeePercentage(bytes32 poolState, uint256 swapFeePercentage) internal virtual {
        _validateSwapFeePercentage(swapFeePercentage);

        _setPoolState(
            ManagedPoolStorageLib.setSwapFeeData(
                poolState,
                block.timestamp,
                block.timestamp,
                swapFeePercentage,
                swapFeePercentage
            )
        );

        emit SwapFeePercentageChanged(swapFeePercentage);
    }

    function _startGradualSwapFeeChange(
        bytes32 poolState,
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    ) internal virtual {
        _validateSwapFeePercentage(startSwapFeePercentage);
        _validateSwapFeePercentage(endSwapFeePercentage);

        if (startSwapFeePercentage != ManagedPoolStorageLib.getSwapFeePercentage(poolState)) {
            _setSwapFeePercentage(poolState, startSwapFeePercentage);
        }

        _setPoolState(
            ManagedPoolStorageLib.setSwapFeeData(
                poolState,
                startTime,
                endTime,
                startSwapFeePercentage,
                endSwapFeePercentage
            )
        );

        emit GradualSwapFeeUpdateScheduled(startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
    }

    function _setPoolState(bytes32 newPoolState) internal virtual;
}
