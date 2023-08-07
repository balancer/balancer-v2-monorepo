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

import "@balancer-labs/v2-pool-utils/contracts/external-fees/InvariantGrowthProtocolSwapFees.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/PoolRegistrationLib.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/BasePoolMath.sol";

import "../lib/WeightedExitsLib.sol";
import "../lib/WeightedJoinsLib.sol";
import "./AssetManagedLBPSettings.sol";

/**
 * @dev Weighted Pool with mutable weights, designed to support V2 Liquidity Bootstrapping: potentially without
 * requiring seed funds. The pool is linmited to two tokens, explicitly identified as the project and reserve
 * tokens, and the reserve token can have an asset manager. It also pays protocol fees in BPT.
 */
contract AssetManagedLiquidityBootstrappingPool is AssetManagedLBPSettings {
    // LiquidityBootstrappingPool change their weights over time: these periods are expected to be long enough (e.g.
    // days) that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using BasePoolUserData for bytes;
    using WeightedPoolUserData for bytes;

    constructor(
        NewPoolParams memory params,
        IVault vault,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        address reserveAssetManager
    )
        AssetManagedLBPSettings(
            params,
            vault,
            PoolRegistrationLib.registerPoolWithAssetManagers(
                vault,
                IVault.PoolSpecialization.TWO_TOKEN,
                _tokenArray(params.projectToken, params.reserveToken),
                _assetManagerArray(reserveAssetManager, params.projectToken < params.reserveToken)
            ),
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function _tokenArray(IERC20 projectToken, IERC20 reserveToken) private pure returns (IERC20[] memory) {
        IERC20[] memory tokens = new IERC20[](2);
        bool projectTokenFirst = projectToken < reserveToken;

        tokens[projectTokenFirst ? 0 : 1] = projectToken;
        tokens[projectTokenFirst ? 1 : 0] = reserveToken;

        return tokens;
    }

    function _assetManagerArray(address reserveAssetManager, bool projectTokenFirst)
        private
        pure
        returns (address[] memory)
    {
        address[] memory assetManagers = new address[](2);
        assetManagers[projectTokenFirst ? 1 : 0] = reserveAssetManager;

        return assetManagers;
    }

    // Pool callback functions

    function _onInitializePool(
        address sender,
        address,
        bytes memory userData
    ) internal virtual override returns (uint256, uint256[] memory) {
        // Only the owner can initialize the pool
        _require(sender == getOwner(), Errors.CALLER_IS_NOT_LBP_OWNER);

        WeightedPoolUserData.JoinKind kind = userData.joinKind();
        _require(kind == WeightedPoolUserData.JoinKind.INIT, Errors.UNINITIALIZED);

        uint256[] memory scalingFactors = getScalingFactors();

        uint256[] memory amountsIn = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsIn.length, scalingFactors.length);
        _upscaleArray(amountsIn, scalingFactors);

        uint256[] memory normalizedWeights = _getNormalizedWeights();
        uint256 invariantAfterJoin = WeightedMath._calculateInvariant(normalizedWeights, amountsIn);

        // Set the initial BPT to the value of the invariant times the number of tokens. This makes BPT supply more
        // consistent in Pools with similar compositions but different number of tokens.
        uint256 bptAmountOut = Math.mul(invariantAfterJoin, amountsIn.length);

        // If there is a managed balance, the pool is unseeded, so we do not want to pull in any reserve tokens
        (, uint256 managed, , ) = getVault().getPoolTokenInfo(getPoolId(), _reserveToken);
        if (managed > 0) {
            amountsIn[_isProjectTokenFirst() ? 1 : 0] = 0;
        }

        return (bptAmountOut, amountsIn);
    }

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

    function _getWeightsAndPreSwapBalances(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) private view returns (uint256[] memory, uint256[] memory) {
        uint256[] memory normalizedWeights = _arrayFill(
            _getNormalizedWeight(swapRequest.tokenIn),
            _getNormalizedWeight(swapRequest.tokenOut)
        );

        uint256[] memory preSwapBalances = _arrayFill(currentBalanceTokenIn, currentBalanceTokenOut);

        return (normalizedWeights, preSwapBalances);
    }

    function _payLbpProtocolFees(
        uint256[] memory normalizedWeights,
        uint256[] memory preSwapBalances,
        uint256[] memory postSwapBalances
    ) private {
        uint256 protocolFeePercentage = getCachedProtocolSwapFeePercentage();

        if (protocolFeePercentage == 0) {
            return;
        }

        uint256 totalSupply = totalSupply();
        uint256 preInvariant = WeightedMath._calculateInvariant(normalizedWeights, preSwapBalances);
        uint256 postInvariant = WeightedMath._calculateInvariant(normalizedWeights, postSwapBalances);
        uint256 bptFeeAmount = InvariantGrowthProtocolSwapFees.calcDueProtocolFees(
            postInvariant.divDown(preInvariant),
            totalSupply,
            totalSupply,
            protocolFeePercentage
        );

        _payProtocolFees(bptFeeAmount);
    }

    function _arrayFill(uint256 a, uint256 b) internal pure returns (uint256[] memory result) {
        result = new uint256[](2);
        result[0] = a;
        result[1] = b;
    }

    function _doRecoveryModeExit(
        uint256[] memory balances,
        uint256 totalSupply,
        bytes memory userData
    ) internal virtual override returns (uint256 bptAmountIn, uint256[] memory amountsOut) {
        bptAmountIn = userData.recoveryModeExit();
        amountsOut = BasePoolMath.computeProportionalAmountsOut(balances, totalSupply, bptAmountIn);
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
            _require(AssetManagedLBPStorageLib.getSwapEnabled(poolState), Errors.SWAPS_DISABLED);

            weightTokenIn = _getNormalizedWeight(request.tokenIn);
            weightTokenOut = _getNormalizedWeight(request.tokenOut);
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

    function _onSwapGeneral(
        SwapRequest memory,
        uint256[] memory,
        uint256,
        uint256
    ) internal virtual override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onExitPool(
        address sender,
        uint256[] memory balances,
        bytes memory userData
    ) internal virtual override returns (uint256 bptAmountIn, uint256[] memory amountsOut) {
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
}
