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

import "@balancer-labs/v2-interfaces/contracts/vault/IBasePool.sol";

import "./ManagedPoolStorageLib.sol";

abstract contract ManagedPoolSwapFees is IBasePool {
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

    /**
     * @notice Returns the current value of the swap fee percentage.
     * @dev Computes the current swap fee percentage, which can change every block if a gradual swap fee
     * update is in progress.
     */
    function getSwapFeePercentage() public view override returns (uint256) {
        return ManagedPoolStorageLib.getSwapFeePercentage(_getPoolState());
    }

    /**
     * @notice Returns the current gradual swap fee update parameters.
     * @dev The current swap fee can be retrieved via `getSwapFeePercentage()`.
     * @return startTime - The timestamp when the swap fee update will begin.
     * @return endTime - The timestamp when the swap fee update will end.
     * @return startSwapFeePercentage - The starting swap fee percentage (could be different from the current value).
     * @return endSwapFeePercentage - The final swap fee percentage, when the current timestamp >= endTime.
     */
    function getGradualSwapFeeUpdateParams()
        external
        view
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256 startSwapFeePercentage,
            uint256 endSwapFeePercentage
        )
    {
        return ManagedPoolStorageLib.getSwapFeeFields(_getPoolState());
    }

    function _setSwapFeePercentage(uint256 swapFeePercentage) internal virtual {
        _validateSwapFeePercentage(swapFeePercentage);

        _setPoolState(
            ManagedPoolStorageLib.setSwapFeeData(
                _getPoolState(),
                block.timestamp,
                block.timestamp,
                swapFeePercentage,
                swapFeePercentage
            )
        );

        emit SwapFeePercentageChanged(swapFeePercentage);
    }

    function _startGradualSwapFeeChange(
        uint256 startTime,
        uint256 endTime,
        uint256 startSwapFeePercentage,
        uint256 endSwapFeePercentage
    ) internal virtual {
        if (startSwapFeePercentage != getSwapFeePercentage()) {
            _setSwapFeePercentage(startSwapFeePercentage);
        }

        _setPoolState(
            ManagedPoolStorageLib.setSwapFeeData(
                _getPoolState(),
                startTime,
                endTime,
                startSwapFeePercentage,
                endSwapFeePercentage
            )
        );

        emit GradualSwapFeeUpdateScheduled(startTime, endTime, startSwapFeePercentage, endSwapFeePercentage);
    }

    function _getPoolState() internal view virtual returns (bytes32);

    function _setPoolState(bytes32 newPoolState) internal virtual;
}
