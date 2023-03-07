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

import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ScalingHelpers.sol";

import "@balancer-labs/v2-pool-utils/contracts/lib/BasePoolMath.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/PoolRegistrationLib.sol";

import "../WeightedMath.sol";
import "../lib/WeightedExitsLib.sol";
import "../lib/WeightedJoinsLib.sol";

import "./LiquidityBootstrappingPoolSettings.sol";
import "./LiquidityBootstrappingPoolStorageLib.sol";

/**
 * @dev Weighted Pool with mutable weights, designed to support V2 Liquidity Bootstrapping.
 */
contract LiquidityBootstrappingPool is LiquidityBootstrappingPoolSettings {
    // LiquidityBootstrappingPool change their weights over time: these periods are expected to be long enough (e.g.
    // days) that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using BasePoolUserData for bytes;
    using WeightedPoolUserData for bytes;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        bool swapEnabledOnStart
    )
        LiquidityBootstrappingPoolSettings(
            vault,
            PoolRegistrationLib.registerPool(
                vault,
                tokens.length == 2 ? IVault.PoolSpecialization.TWO_TOKEN : IVault.PoolSpecialization.MINIMAL_SWAP_INFO,
                tokens
            ),
            name,
            symbol,
            tokens,
            normalizedWeights,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner,
            swapEnabledOnStart
        )
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    // Swap Hooks

    function _onSwapGeneral(
        SwapRequest memory,
        uint256[] memory,
        uint256,
        uint256
    ) internal virtual override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onSwapMinimal(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal virtual override returns (uint256) {
        uint256 weightTokenIn;
        uint256 weightTokenOut;
        {
            bytes32 poolState = _getPoolState();
            _require(LiquidityBootstrappingPoolStorageLib.getSwapEnabled(poolState), Errors.SWAPS_DISABLED);

            uint256 pctProgress = LiquidityBootstrappingPoolStorageLib.getWeightChangeProgress(poolState);

            weightTokenIn = LiquidityBootstrappingPoolStorageLib.getNormalizedWeightByIndex(
                poolState,
                _getTokenIndex(request.tokenIn),
                pctProgress
            );
            weightTokenOut = LiquidityBootstrappingPoolStorageLib.getNormalizedWeightByIndex(
                poolState,
                _getTokenIndex(request.tokenOut),
                pctProgress
            );
        }

        uint256 scalingFactorTokenIn = _scalingFactor(request.tokenIn);
        uint256 scalingFactorTokenOut = _scalingFactor(request.tokenOut);

        balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
        balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);

        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            // Fees are subtracted before scaling, to reduce the complexity of the rounding direction analysis.
            // This returns amount - fee amount, so we round down (favoring a higher fee amount).
            request.amount = request.amount.mulDown(getSwapFeePercentage().complement());

            // All token amounts are upscaled.
            request.amount = _upscale(request.amount, scalingFactorTokenIn);

            uint256 amountOut = WeightedMath._calcOutGivenIn(
                balanceTokenIn,
                weightTokenIn,
                balanceTokenOut,
                weightTokenOut,
                request.amount
            );

            // amountOut tokens are exiting the Pool, so we round down.
            return _downscaleDown(amountOut, scalingFactorTokenOut);
        } else {
            // All token amounts are upscaled.
            request.amount = _upscale(request.amount, scalingFactorTokenOut);

            uint256 amountIn = WeightedMath._calcInGivenOut(
                balanceTokenIn,
                weightTokenIn,
                balanceTokenOut,
                weightTokenOut,
                request.amount
            );

            // amountIn tokens are entering the Pool, so we round up.
            amountIn = _downscaleUp(amountIn, scalingFactorTokenIn);

            // Fees are added after scaling happens, to reduce the complexity of the rounding direction analysis.
            // This returns amount + fee amount, so we round up (favoring a higher fee amount).
            return amountIn.divUp(getSwapFeePercentage().complement());
        }
    }

    // Initialize hook

    function _onInitializePool(
        address sender,
        address,
        bytes memory userData
    ) internal view override returns (uint256, uint256[] memory) {
        // Only the owner can initialize the pool
        _require(sender == getOwner(), Errors.CALLER_IS_NOT_LBP_OWNER);

        WeightedPoolUserData.JoinKind kind = userData.joinKind();
        _require(kind == WeightedPoolUserData.JoinKind.INIT, Errors.UNINITIALIZED);

        uint256[] memory amountsIn = userData.initialAmountsIn();
        uint256[] memory scalingFactors = getScalingFactors();

        InputHelpers.ensureInputLengthMatch(amountsIn.length, scalingFactors.length);
        _upscaleArray(amountsIn, scalingFactors);

        uint256[] memory normalizedWeights = _getNormalizedWeights();
        uint256 invariantAfterJoin = WeightedMath._calculateInvariant(normalizedWeights, amountsIn);

        // Set the initial BPT to the value of the invariant times the number of tokens. This makes the BPT supply
        // more consistent in Pools with similar token composition, but a different number of tokens.
        uint256 bptAmountOut = Math.mul(invariantAfterJoin, amountsIn.length);

        return (bptAmountOut, amountsIn);
    }

    // Join hook

    /**
     * @dev Called whenever the Pool is joined after the first initialization join (see `_onInitializePool`).
     *
     * Returns the amount of BPT to mint, the token amounts that the Pool will receive in return, and the number of
     * tokens to pay in protocol swap fees.
     *
     * Implementations of this function might choose to mutate the `balances` array to save gas (e.g. when
     * performing intermediate calculations, such as subtraction of due protocol fees). This can be done safely.
     *
     * Minted BPT will be sent to `recipient`.
     *
     * The tokens granted to the Pool will be transferred from `sender`. These amounts are considered upscaled and will
     * be downscaled (rounding up) before being returned to the Vault.
     */
    function _onJoinPool(
        address sender,
        uint256[] memory balances,
        bytes memory userData
    ) internal view override returns (uint256, uint256[] memory) {
        // Only the owner can add liquidity; block public LPs
        _require(sender == getOwner(), Errors.CALLER_IS_NOT_LBP_OWNER);

        (uint256 bptAmountOut, uint256[] memory amountsIn) = _doJoin(
            sender,
            balances,
            _getNormalizedWeights(),
            getScalingFactors(),
            totalSupply(),
            userData
        );

        return (bptAmountOut, amountsIn);
    }

    /**
     * @dev Dispatch code which decodes the provided userdata to perform the specified join type.
     * Inheriting contracts may override this function to add additional join types or extra conditions to allow
     * or disallow joins under certain circumstances.
     */
    function _doJoin(
        address,
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        uint256 totalSupply,
        bytes memory userData
    ) internal view returns (uint256, uint256[] memory) {
        WeightedPoolUserData.JoinKind kind = userData.joinKind();

        if (kind == WeightedPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return
                WeightedJoinsLib.joinExactTokensInForBPTOut(
                    balances,
                    normalizedWeights,
                    scalingFactors,
                    totalSupply,
                    getSwapFeePercentage(),
                    userData
                );
        } else if (kind == WeightedPoolUserData.JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return
                WeightedJoinsLib.joinTokenInForExactBPTOut(
                    balances,
                    normalizedWeights,
                    totalSupply,
                    getSwapFeePercentage(),
                    userData
                );
        } else if (kind == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {
            return WeightedJoinsLib.joinAllTokensInForExactBPTOut(balances, totalSupply, userData);
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    // Exit hook

    /**
     * @dev Called whenever the Pool is exited.
     *
     * Returns the amount of BPT to burn, the token amounts for each Pool token that the Pool will grant in return, and
     * the number of tokens to pay in protocol swap fees.
     *
     * Implementations of this function might choose to mutate the `balances` array to save gas (e.g. when
     * performing intermediate calculations, such as subtraction of due protocol fees). This can be done safely.
     *
     * BPT will be burnt from `sender`.
     *
     * The Pool will grant tokens to `recipient`. These amounts are considered upscaled and will be downscaled
     * (rounding down) before being returned to the Vault.
     */
    function _onExitPool(
        address sender,
        uint256[] memory balances,
        bytes memory userData
    ) internal view override returns (uint256, uint256[] memory) {
        return _doExit(sender, balances, _getNormalizedWeights(), getScalingFactors(), totalSupply(), userData);
    }

    /**
     * @dev Dispatch code which decodes the provided userdata to perform the specified exit type.
     * Inheriting contracts may override this function to add additional exit types or extra conditions to allow
     * or disallow exit under certain circumstances.
     */
    function _doExit(
        address,
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        uint256 totalSupply,
        bytes memory userData
    ) internal view returns (uint256, uint256[] memory) {
        WeightedPoolUserData.ExitKind kind = userData.exitKind();

        if (kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
            return
                WeightedExitsLib.exitExactBPTInForTokenOut(
                    balances,
                    normalizedWeights,
                    totalSupply,
                    getSwapFeePercentage(),
                    userData
                );
        } else if (kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {
            return WeightedExitsLib.exitExactBPTInForTokensOut(balances, totalSupply, userData);
        } else if (kind == WeightedPoolUserData.ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT) {
            return
                WeightedExitsLib.exitBPTInForExactTokensOut(
                    balances,
                    normalizedWeights,
                    scalingFactors,
                    totalSupply,
                    getSwapFeePercentage(),
                    userData
                );
        } else {
            _revert(Errors.UNHANDLED_EXIT_KIND);
        }
    }

    // Recovery Mode

    function _doRecoveryModeExit(
        uint256[] memory balances,
        uint256 totalSupply,
        bytes memory userData
    ) internal pure override returns (uint256 bptAmountIn, uint256[] memory amountsOut) {
        bptAmountIn = userData.recoveryModeExit();
        amountsOut = BasePoolMath.computeProportionalAmountsOut(balances, totalSupply, bptAmountIn);
    }
}
