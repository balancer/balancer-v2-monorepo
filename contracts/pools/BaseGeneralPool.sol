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

abstract contract BaseGeneralPool is IGeneralPool, BasePool {
    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 swapFee
    ) BasePool(vault, IVault.PoolSpecialization.GENERAL, name, symbol, tokens, swapFee) {
        // solhint-disable-previous-line no-empty-blocks
    }

    // Swap Hooks

    function onSwapGivenIn(
        IPoolSwapStructs.SwapRequestGivenIn memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint256) {
        _validateIndexes(indexIn, indexOut, _totalTokens);

        // Fees are subtracted before scaling happens, to reduce complexity of rounding direction analysis.
        swapRequest.amountIn = _subtractSwapFee(swapRequest.amountIn);

        uint256[] memory scalingFactors = _scalingFactors();

        // All token amounts are upscaled.
        swapRequest.amountIn = _upscale(swapRequest.amountIn, scalingFactors[indexIn]);
        _upscaleArray(balances, scalingFactors);

        uint256 amountOut = _onSwapGivenIn(swapRequest, balances, indexIn, indexOut);

        // amountOut tokens are exiting the Pool, so we round down.
        return _downscaleDown(amountOut, scalingFactors[indexOut]);
    }

    function onSwapGivenOut(
        IPoolSwapStructs.SwapRequestGivenOut memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint256) {
        _validateIndexes(indexIn, indexOut, _totalTokens);

        uint256[] memory scalingFactors = _scalingFactors();

        // All token amounts are upscaled.
        swapRequest.amountOut = _upscale(swapRequest.amountOut, scalingFactors[indexOut]);
        _upscaleArray(balances, scalingFactors);

        uint256 amountIn = _onSwapGivenOut(swapRequest, balances, indexIn, indexOut);

        // amountIn are tokens entering the Pool, so we round up.
        amountIn = _downscaleUp(amountIn, scalingFactors[indexIn]);

        // Fees are added after scaling happens, to reduce complexity of rounding direction analysis.
        return _addSwapFee(amountIn);
    }

    function _onSwapGivenIn(
        IPoolSwapStructs.SwapRequestGivenIn memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal view virtual returns (uint256);

    function _onSwapGivenOut(
        IPoolSwapStructs.SwapRequestGivenOut memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal view virtual returns (uint256);

    function _validateIndexes(
        uint256 indexIn,
        uint256 indexOut,
        uint256 limit
    ) private pure {
        require(indexIn < limit && indexOut < limit, "OUT_OF_BOUNDS");
    }
}
