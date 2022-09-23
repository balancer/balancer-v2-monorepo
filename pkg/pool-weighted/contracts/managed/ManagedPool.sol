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

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";

import "../lib/WeightedExitsLib.sol";
import "../lib/WeightedJoinsLib.sol";
import "../WeightedMath.sol";

import "./ManagedPoolSettings.sol";

/**
 * @title Managed Pool
 * @dev Weighted Pool with mutable tokens and weights, designed to be used in conjunction with a pool controller
 * contract (as the owner, containing any specific business logic). Since the pool itself permits "dangerous"
 * operations, it should never be deployed with an EOA as the owner.
 *
 * Pool controllers can add functionality: for example, allow the effective "owner" to be transferred to another
 * address. (The actual pool owner is still immutable, set to the pool controller contract.) Another pool owner
 * might allow fine-grained permissioning of protected operations: perhaps a multisig can add/remove tokens, but
 * a third-party EOA is allowed to set the swap fees.
 *
 * Pool controllers might also impose limits on functionality so that operations that might endanger LPs can be
 * performed more safely. For instance, the pool by itself places no restrictions on the duration of a gradual
 * weight change, but a pool controller might restrict this in various ways, from a simple minimum duration,
 * to a more complex rate limit.
 *
 * Pool controllers can also serve as intermediate contracts to hold tokens, deploy timelocks, consult with other
 * protocols or on-chain oracles, or bundle several operations into one transaction that re-entrancy protection
 * would prevent initiating from the pool contract.
 *
 * Managed Pools and their controllers are designed to support many asset management use cases, including: large
 * token counts, rebalancing through token changes, gradual weight or fee updates, fine-grained control of
 * protocol and management fees, allowlisting of LPs, and more.
 */
contract ManagedPool is ManagedPoolSettings {
    // ManagedPool weights and swap fees can change over time: these periods are expected to be long enough (e.g. days)
    // that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WeightedPoolUserData for bytes;

    constructor(
        NewPoolParams memory params,
        IVault vault,
        IProtocolFeePercentagesProvider protocolFeeProvider,
        address owner,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration
    ) ManagedPoolSettings(params, vault, protocolFeeProvider, owner, pauseWindowDuration, bufferPeriodDuration) {
        // solhint-disable-previous-line no-empty-blocks
    }

    // Swap Hooks

    function _onSwapMinimal(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal view override returns (uint256) {
        bytes32 poolState = _getPoolState();
        _require(ManagedPoolStorageLib.getSwapsEnabled(poolState), Errors.SWAPS_DISABLED);

        uint256 weightChangeProgress = ManagedPoolStorageLib.getGradualWeightChangeProgress(poolState);
        uint256 tokenInWeight = _getNormalizedWeight(request.tokenIn, weightChangeProgress);
        uint256 tokenOutWeight = _getNormalizedWeight(request.tokenOut, weightChangeProgress);

        uint256 swapFeeComplement = ManagedPoolStorageLib.getSwapFeePercentage(poolState).complement();

        uint256 scalingFactorTokenIn = _scalingFactor(request.tokenIn);
        uint256 scalingFactorTokenOut = _scalingFactor(request.tokenOut);

        balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
        balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);

        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            // All token amounts are upscaled.
            request.amount = _upscale(request.amount, scalingFactorTokenIn);

            uint256 amountOut = _onSwapGivenIn(
                request,
                balanceTokenIn,
                balanceTokenOut,
                tokenInWeight,
                tokenOutWeight,
                swapFeeComplement
            );

            // amountOut tokens are exiting the Pool, so we round down.
            return _downscaleDown(amountOut, scalingFactorTokenOut);
        } else {
            // All token amounts are upscaled.
            request.amount = _upscale(request.amount, scalingFactorTokenOut);

            uint256 amountIn = _onSwapGivenOut(
                request,
                balanceTokenIn,
                balanceTokenOut,
                tokenInWeight,
                tokenOutWeight,
                swapFeeComplement
            );

            // amountIn tokens are entering the Pool, so we round up.
            return _downscaleUp(amountIn, scalingFactorTokenIn);
        }
    }

    /**
     * @dev Unimplemented as ManagedPool uses the MinimalInfoSwap Pool specialization.
     */
    function _onSwapGeneral(
        SwapRequest memory, /*request*/
        uint256[] memory, /* balances*/
        uint256, /* indexIn */
        uint256 /*indexOut */
    ) internal pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    /*
     * @dev Called when a swap with the Pool occurs, where the amount of tokens entering the Pool is known.
     *
     * Returns the amount of tokens that will be taken from the Pool in return.
     *
     * All amounts inside `request`, `currentBalanceTokenIn`, and `currentBalanceTokenOut` are upscaled.
     *
     * The return value is also considered upscaled, and will be downscaled (rounding down) before returning it to the
     * Vault.
     */
    function _onSwapGivenIn(
        SwapRequest memory request,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut,
        uint256 tokenInWeight,
        uint256 tokenOutWeight,
        uint256 swapFeeComplement
    ) internal pure returns (uint256 amountOut) {
        // Balances (and request.amount) are already upscaled by `_onSwapMinimal()`

        // We round the amount in down (favoring a higher fee amount).
        request.amount = request.amount.mulDown(swapFeeComplement);

        amountOut = WeightedMath._calcOutGivenIn(
            currentBalanceTokenIn,
            tokenInWeight,
            currentBalanceTokenOut,
            tokenOutWeight,
            request.amount
        );
    }

    /*
     * @dev Called when a swap with the Pool occurs, where the amount of tokens exiting the Pool is known.
     *
     * Returns the amount of tokens that will be granted to the Pool in return.
     *
     * All amounts inside `request`, `currentBalanceTokenIn`, and `currentBalanceTokenOut` are upscaled.
     *
     * The return value is also considered upscaled, and will be downscaled (rounding up) before returning it to the
     * Vault.
     */
    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut,
        uint256 tokenInWeight,
        uint256 tokenOutWeight,
        uint256 swapFeeComplement
    ) internal pure returns (uint256 amountIn) {
        // Balances (and request.amount) are already upscaled by `_onSwapMinimal()`

        amountIn = WeightedMath._calcInGivenOut(
            currentBalanceTokenIn,
            tokenInWeight,
            currentBalanceTokenOut,
            tokenOutWeight,
            request.amount
        );

        // We round the amount in up (favoring a higher fee amount).
        amountIn = amountIn.divUp(swapFeeComplement);
    }

    /**
     * @dev Called before any join or exit operation. Returns the Pool's total supply by default, but derived contracts
     * may choose to add custom behavior at these steps. This often has to do with protocol fee processing.
     */
    function _beforeJoinExit() internal returns (uint256) {
        // The AUM fee calculation is based on inflating the Pool's BPT supply by a target rate.
        // We then must collect AUM fees whenever joining or exiting the pool to ensure that LPs only pay AUM fees
        // for the period during which they are an LP within the pool: otherwise an LP could shift their share of the
        // AUM fees onto the remaining LPs in the pool by exiting before they were paid.
        uint256 supplyBeforeFeeCollection = totalSupply();
        (uint256 protocolAUMFees, uint256 managerAUMFees) = _collectAumManagementFees(supplyBeforeFeeCollection);

        return supplyBeforeFeeCollection.add(protocolAUMFees + managerAUMFees);
    }

    // Initialize

    function _onInitializePool(address, bytes memory userData) internal override returns (uint256, uint256[] memory) {
        WeightedPoolUserData.JoinKind kind = userData.joinKind();
        _require(kind == WeightedPoolUserData.JoinKind.INIT, Errors.UNINITIALIZED);

        (IERC20[] memory tokens, ) = _getPoolTokens();
        uint256[] memory amountsIn = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsIn.length, tokens.length);

        uint256[] memory scalingFactors = _scalingFactors(tokens);
        _upscaleArray(amountsIn, scalingFactors);

        uint256 invariantAfterJoin = WeightedMath._calculateInvariant(_getNormalizedWeights(tokens), amountsIn);

        // Set the initial BPT to the value of the invariant times the number of tokens. This makes BPT supply more
        // consistent in Pools with similar compositions but different number of tokens.
        uint256 bptAmountOut = Math.mul(invariantAfterJoin, amountsIn.length);

        // We want to start collecting AUM fees from this point onwards. Prior to initialization the Pool holds no funds
        // so naturally charges no AUM fees.
        _lastAumFeeCollectionTimestamp = block.timestamp;

        // amountsIn are amounts entering the Pool, so we round up.
        _downscaleUpArray(amountsIn, scalingFactors);

        return (bptAmountOut, amountsIn);
    }

    // Join

    function _onJoinPool(
        address sender,
        uint256[] memory balances,
        bytes memory userData
    ) internal virtual override returns (uint256 bptAmountOut, uint256[] memory amountsIn) {
        (IERC20[] memory tokens, ) = _getPoolTokens();

        uint256[] memory scalingFactors = _scalingFactors(tokens);
        _upscaleArray(balances, scalingFactors);

        uint256 preJoinExitSupply = _beforeJoinExit();

        (bptAmountOut, amountsIn) = _doJoin(
            sender,
            balances,
            _getNormalizedWeights(tokens),
            scalingFactors,
            preJoinExitSupply,
            userData
        );

        // amountsIn are amounts entering the Pool, so we round up.
        _downscaleUpArray(amountsIn, scalingFactors);
    }

    /**
     * @dev Dispatch code which decodes the provided userdata to perform the specified join type.
     */
    function _doJoin(
        address sender,
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        uint256 totalSupply,
        bytes memory userData
    ) internal view returns (uint256, uint256[] memory) {
        // If swaps are disabled, only proportional joins are allowed. All others involve implicit swaps, and alter
        // token prices.

        bytes32 poolState = _getPoolState();
        WeightedPoolUserData.JoinKind kind = userData.joinKind();
        _require(
            ManagedPoolStorageLib.getSwapsEnabled(poolState) ||
                kind == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT,
            Errors.INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED
        );

        // Check allowlist for LPs, if applicable
        _require(isAllowedAddress(sender), Errors.ADDRESS_NOT_ALLOWLISTED);

        if (kind == WeightedPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return
                WeightedJoinsLib.joinExactTokensInForBPTOut(
                    balances,
                    normalizedWeights,
                    scalingFactors,
                    totalSupply,
                    ManagedPoolStorageLib.getSwapFeePercentage(poolState),
                    userData
                );
        } else if (kind == WeightedPoolUserData.JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return
                WeightedJoinsLib.joinTokenInForExactBPTOut(
                    balances,
                    normalizedWeights,
                    totalSupply,
                    ManagedPoolStorageLib.getSwapFeePercentage(poolState),
                    userData
                );
        } else if (kind == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {
            return WeightedJoinsLib.joinAllTokensInForExactBPTOut(balances, totalSupply, userData);
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    // Exit

    function _onExitPool(
        address sender,
        uint256[] memory balances,
        bytes memory userData
    ) internal virtual override returns (uint256 bptAmountIn, uint256[] memory amountsOut) {
        (IERC20[] memory tokens, ) = _getPoolTokens();

        uint256[] memory scalingFactors = _scalingFactors(tokens);
        _upscaleArray(balances, scalingFactors);

        uint256 preJoinExitSupply = _beforeJoinExit();

        (bptAmountIn, amountsOut) = _doExit(
            sender,
            balances,
            _getNormalizedWeights(tokens),
            scalingFactors,
            preJoinExitSupply,
            userData
        );

        // amountsOut are amounts exiting the Pool, so we round down.
        _downscaleDownArray(amountsOut, scalingFactors);
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
    ) internal view virtual returns (uint256, uint256[] memory) {
        // If swaps are disabled, only proportional exits are allowed. All others involve implicit swaps, and alter
        // token prices.

        bytes32 poolState = _getPoolState();
        WeightedPoolUserData.ExitKind kind = userData.exitKind();
        _require(
            ManagedPoolStorageLib.getSwapsEnabled(poolState) ||
                kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT,
            Errors.INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED
        );

        // Note that we do not perform any check on the LP allowlist here. LPs must always be able to exit the pool
        // and enforcing the allowlist would allow the manager to perform DOS attacks on LPs.

        if (kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
            return
                WeightedExitsLib.exitExactBPTInForTokenOut(
                    balances,
                    normalizedWeights,
                    totalSupply,
                    ManagedPoolStorageLib.getSwapFeePercentage(poolState),
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
                    ManagedPoolStorageLib.getSwapFeePercentage(poolState),
                    userData
                );
        } else {
            _revert(Errors.UNHANDLED_EXIT_KIND);
        }
    }
}
