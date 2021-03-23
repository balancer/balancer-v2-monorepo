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
import "../vault/interfaces/IMinimalSwapInfoPool.sol";

abstract contract BaseMinimalSwapInfoPool is IMinimalSwapInfoPool, BasePool {
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
            tokens.length == 2 ? IVault.PoolSpecialization.TWO_TOKEN : IVault.PoolSpecialization.MINIMAL_SWAP_INFO,
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
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) external view virtual override returns (uint256) {
        uint256 scalingFactorTokenIn = _scalingFactor(request.tokenIn);
        uint256 scalingFactorTokenOut = _scalingFactor(request.tokenOut);

        return
            request.kind == IVault.SwapKind.GIVEN_IN
                ? _swapGivenIn(request, balanceTokenIn, balanceTokenOut, scalingFactorTokenIn, scalingFactorTokenOut)
                : _swapGivenOut(request, balanceTokenIn, balanceTokenOut, scalingFactorTokenIn, scalingFactorTokenOut);
    }

    function _swapGivenIn(
        SwapRequest memory swapRequest,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 scalingFactorTokenIn,
        uint256 scalingFactorTokenOut
    ) internal view returns (uint256) {
        // Fees are subtracted before scaling happens, to reduce complexity of rounding direction analysis.
        swapRequest.amount = _subtractSwapFee(swapRequest.amount);

        // All token amounts are upscaled.
        balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
        balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);
        swapRequest.amount = _upscale(swapRequest.amount, scalingFactorTokenIn);

        uint256 amountOut = _onSwapGivenIn(swapRequest, balanceTokenIn, balanceTokenOut);

        // amountOut tokens are exiting the Pool, so we round down.
        return _downscaleDown(amountOut, scalingFactorTokenOut);
    }

    function _swapGivenOut(
        SwapRequest memory swapRequest,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 scalingFactorTokenIn,
        uint256 scalingFactorTokenOut
    ) internal view returns (uint256) {
        // All token amounts are upscaled.
        balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
        balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);
        swapRequest.amount = _upscale(swapRequest.amount, scalingFactorTokenOut);

        uint256 amountIn = _onSwapGivenOut(swapRequest, balanceTokenIn, balanceTokenOut);

        // amountIn are tokens entering the Pool, so we round up.
        amountIn = _downscaleUp(amountIn, scalingFactorTokenIn);

        // Fees are added after scaling happens, to reduce complexity of rounding direction analysis.
        return _addSwapFee(amountIn);
    }

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal view virtual returns (uint256);

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal view virtual returns (uint256);
}
