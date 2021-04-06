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

import "./BasePool.sol";
import "../vault/interfaces/IGeneralPool.sol";

/**
 * @dev Extension of `BasePool`, adding a handler for `IGeneralPool.onSwap`.
 *
 * Derived contracts must implement `_onSwapGivenIn` and `_onSwapGivenOut` along with `BasePool`'s virtual functions.
 */
abstract contract BaseGeneralPool is IGeneralPool, BasePool {
    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 swapFee,
        uint256 emergencyPeriod,
        uint256 emergencyPeriodCheckExtension
    )
        BasePool(
            vault,
            IVault.PoolSpecialization.GENERAL,
            name,
            symbol,
            tokens,
            swapFee,
            emergencyPeriod,
            emergencyPeriodCheckExtension
        )
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    // Swap Hooks

    function onSwap(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view virtual override returns (uint256) {
        _validateIndexes(indexIn, indexOut, _totalTokens);
        uint256[] memory scalingFactors = _scalingFactors();

        return
            swapRequest.kind == IVault.SwapKind.GIVEN_IN
                ? _swapGivenIn(swapRequest, balances, indexIn, indexOut, scalingFactors)
                : _swapGivenOut(swapRequest, balances, indexIn, indexOut, scalingFactors);
    }

    function _swapGivenIn(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut,
        uint256[] memory scalingFactors
    ) internal view returns (uint256) {
        // Fees are subtracted before scaling, to reduce the complexity of the rounding direction analysis.
        swapRequest.amount = _subtractSwapFee(swapRequest.amount);

        _upscaleArray(balances, scalingFactors);
        swapRequest.amount = _upscale(swapRequest.amount, scalingFactors[indexIn]);

        uint256 amountOut = _onSwapGivenIn(swapRequest, balances, indexIn, indexOut);

        // amountOut tokens are exiting the Pool, so we round down.
        return _downscaleDown(amountOut, scalingFactors[indexOut]);
    }

    function _swapGivenOut(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut,
        uint256[] memory scalingFactors
    ) internal view returns (uint256) {
        _upscaleArray(balances, scalingFactors);
        swapRequest.amount = _upscale(swapRequest.amount, scalingFactors[indexOut]);

        uint256 amountIn = _onSwapGivenOut(swapRequest, balances, indexIn, indexOut);

        // amountIn tokens are entering the Pool, so we round up.
        amountIn = _downscaleUp(amountIn, scalingFactors[indexIn]);

        // Fees are added after scaling happens, to reduce the complexity of the rounding direction analysis.
        return _addSwapFee(amountIn);
    }

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal view virtual returns (uint256);

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal view virtual returns (uint256);

    function _validateIndexes(
        uint256 indexIn,
        uint256 indexOut,
        uint256 limit
    ) private pure {
        _require(indexIn < limit && indexOut < limit, Errors.OUT_OF_BOUNDS);
    }
}
