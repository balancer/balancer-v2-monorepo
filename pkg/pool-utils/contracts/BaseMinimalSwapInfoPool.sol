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
import "@balancer-labs/v2-vault/contracts/interfaces/IMinimalSwapInfoPool.sol";

/**
 * @dev Extension of `BasePool`, adding a handler for `IMinimalSwapInfoPool.onSwap`.
 *
 * Derived contracts must call `BasePool`'s constructor, and implement `_onSwapGivenIn` and `_onSwapGivenOut` along with
 * `BasePool`'s virtual functions. Inheriting from this contract lets derived contracts choose the Two Token or Minimal
 * Swap Info specialization settings.
 */
abstract contract BaseMinimalSwapInfoPool is IMinimalSwapInfoPool, BasePool {
    // Swap Hooks

    function onSwap(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) public virtual override onlyVault(request.poolId) returns (uint256) {
        uint256 scalingFactorTokenIn = _scalingFactor(request.tokenIn);
        uint256 scalingFactorTokenOut = _scalingFactor(request.tokenOut);

        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            // Fees are subtracted before scaling, to reduce the complexity of the rounding direction analysis.
            uint256 amountInMinusSwapFees = _subtractSwapFeeAmount(request.amount);

            // Process the (upscaled!) swap fee.
            uint256 swapFee = request.amount - amountInMinusSwapFees;
            _processSwapFeeAmount(request.tokenIn, _upscale(swapFee, scalingFactorTokenIn));

            request.amount = amountInMinusSwapFees;

            // All token amounts are upscaled.
            balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
            balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);
            request.amount = _upscale(request.amount, scalingFactorTokenIn);

            uint256 amountOut = _onSwapGivenIn(request, balanceTokenIn, balanceTokenOut);

            // amountOut tokens are exiting the Pool, so we round down.
            return _downscaleDown(amountOut, scalingFactorTokenOut);
        } else {
            // All token amounts are upscaled.
            balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
            balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);
            request.amount = _upscale(request.amount, scalingFactorTokenOut);

            uint256 amountIn = _onSwapGivenOut(request, balanceTokenIn, balanceTokenOut);

            // amountIn tokens are entering the Pool, so we round up.
            amountIn = _downscaleUp(amountIn, scalingFactorTokenIn);

            // Fees are added after scaling happens, to reduce the complexity of the rounding direction analysis.
            uint256 amountInPlusSwapFees = _addSwapFeeAmount(amountIn);

            // Process the (upscaled!) swap fee.
            uint256 swapFee = amountInPlusSwapFees - amountIn;
            _processSwapFeeAmount(request.tokenIn, _upscale(swapFee, scalingFactorTokenIn));

            return amountInPlusSwapFees;
        }
    }

    /*
     * @dev Called when a swap with the Pool occurs, where the amount of tokens entering the Pool is known.
     *
     * Returns the amount of tokens that will be taken from the Pool in return.
     *
     * All amounts inside `swapRequest`, `balanceTokenIn` and `balanceTokenOut` are upscaled. The swap fee has already
     * been deducted from `swapRequest.amount`.
     *
     * The return value is also considered upscaled, and will be downscaled (rounding down) before returning it to the
     * Vault.
     */
    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal virtual returns (uint256);

    /*
     * @dev Called when a swap with the Pool occurs, where the amount of tokens exiting the Pool is known.
     *
     * Returns the amount of tokens that will be granted to the Pool in return.
     *
     * All amounts inside `swapRequest`, `balanceTokenIn` and `balanceTokenOut` are upscaled.
     *
     * The return value is also considered upscaled, and will be downscaled (rounding up) before applying the swap fee
     * and returning it to the Vault.
     */
    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal virtual returns (uint256);

    /**
     * @dev Called whenever a swap fee is charged. Implementations should call their parents via super, to ensure all
     * implementations in the inheritance tree are called.
     *
     * Callers must call one of the three `_processSwapFeeAmount` functions when swap fees are computed,
     * and upscale `amount`.
     */
    function _processSwapFeeAmount(
        uint256, /*index*/
        uint256 /*amount*/
    ) internal virtual {
        // solhint-disable-previous-line no-empty-blocks
    }

    function _processSwapFeeAmount(IERC20 token, uint256 amount) internal {
        _processSwapFeeAmount(_tokenAddressToIndex(token), amount);
    }

    function _processSwapFeeAmounts(uint256[] memory amounts) internal {
        InputHelpers.ensureInputLengthMatch(amounts.length, _getTotalTokens());

        for (uint256 i = 0; i < _getTotalTokens(); ++i) {
            _processSwapFeeAmount(i, amounts[i]);
        }
    }

    /**
     * @dev Returns the index of `token` in the Pool's token array (i.e. the one `vault.getPoolTokens()` would return).
     *
     * A trivial (and incorrect!) implementation is already provided for Pools that don't override
     * `_processSwapFeeAmount` and skip the entire feature. However, Pools that do override `_processSwapFeeAmount`
     * *must* override this function with a meaningful implementation.
     */
    function _tokenAddressToIndex(
        IERC20 /*token*/
    ) internal view virtual returns (uint256) {
        return 0;
    }
}
