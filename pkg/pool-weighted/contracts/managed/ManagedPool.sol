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

import "@balancer-labs/v2-pool-utils/contracts/lib/ComposablePoolLib.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/PoolRegistrationLib.sol";

import "../lib/WeightedExitsLib.sol";
import "../lib/WeightedJoinsLib.sol";
import "../WeightedMath.sol";

import "./ManagedPoolSettings.sol";

/**
 * @title Managed Pool
 * @dev Weighted Pool with mutable tokens and weights, designed to be used in conjunction with a contract
 * (as the owner, containing any specific business logic). Since the pool itself permits "dangerous"
 * operations, it should never be deployed with an EOA as the owner.
 *
 * The owner contract can impose arbitrary access control schemes on its permissions: it might allow a multisig
 * to add or remove tokens, and let an EOA set the swap fees.
 *
 * Pool owners can also serve as intermediate contracts to hold tokens, deploy timelocks, consult with
 * other protocols or on-chain oracles, or bundle several operations into one transaction that re-entrancy
 * protection would prevent initiating from the pool contract.
 *
 * Managed Pools are designed to support many asset management use cases, including: large token counts,
 * rebalancing through token changes, gradual weight or fee updates, fine-grained control of protocol and
 * management fees, allowlisting of LPs, and more.
 */
contract ManagedPool is ManagedPoolSettings {
    // ManagedPool weights and swap fees can change over time: these periods are expected to be long enough (e.g. days)
    // that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using WeightedPoolUserData for bytes;

    // The maximum imposed by the Vault, which stores balances in a packed format, is 2**(112) - 1.
    // We are preminting half of that value (rounded up).
    uint256 private constant _PREMINTED_TOKEN_BALANCE = 2**(111);

    constructor(
        NewPoolParams memory params,
        IVault vault,
        IProtocolFeePercentagesProvider protocolFeeProvider,
        address owner,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration
    )
        BasePool(
            vault,
            PoolRegistrationLib.registerComposablePool(
                vault,
                IVault.PoolSpecialization.MINIMAL_SWAP_INFO,
                params.tokens,
                params.assetManagers
            ),
            params.name,
            params.symbol,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
        ManagedPoolSettings(params, protocolFeeProvider)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    // Virtual Supply

    /**
     * @notice Returns the number of tokens in circulation.
     * @dev In other pools, this would be the same as `totalSupply`, but since this pool pre-mints BPT and holds it in
     * the Vault as a token, we need to subtract the Vault's balance to get the total "circulating supply". Both the
     * totalSupply and Vault balance can change. If users join or exit using swaps, some of the preminted BPT are
     * exchanged, so the Vault's balance increases after joins and decreases after exits. If users call the recovery
     * mode exit function, the totalSupply can change as BPT are burned.
     */
    function _getVirtualSupply() internal view override returns (uint256) {
        (uint256 cash, uint256 managed, , ) = getVault().getPoolTokenInfo(getPoolId(), IERC20(this));
        return totalSupply() - (cash + managed);
    }

    // Swap Hooks

    /**
     * @dev Dispatch code for all kinds of swaps. Depending on the tokens involved this could result in a join, exit or
     * a standard swap between two token in the Pool.
     *
     * The return value is expected to be downscaled (appropriately rounded based on the swap type) ready to be passed
     * to the Vault.
     */
    function _onSwapMinimal(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) internal view override returns (uint256) {
        bytes32 poolState = _getPoolState();
        _require(ManagedPoolStorageLib.getSwapsEnabled(poolState), Errors.SWAPS_DISABLED);

        // solhint-disable no-empty-blocks
        if (request.tokenOut == IERC20(this)) {
            // Do a joinSwap
        } else if (request.tokenIn == IERC20(this)) {
            // Do an exitSwap
        } else {
            return _onTokenSwap(request, balanceTokenIn, balanceTokenOut, poolState);
        }
        // solhint-enable no-empty-blocks
    }

    /*
     * @dev Called when a swap with the Pool occurs, where neither of the tokens involved are the BPT of the Pool.
     *
     * This function is responsible for upscaling any amounts received, in particular `balanceTokenIn`,
     * `balanceTokenOut` and `request.amount`.
     *
     * The return value is expected to be downscaled (appropriately rounded based on the swap type) ready to be passed
     * to the Vault.
     */
    function _onTokenSwap(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        bytes32 poolState
    ) internal view returns (uint256) {
        uint256 tokenInWeight;
        uint256 tokenOutWeight;
        uint256 scalingFactorTokenIn;
        uint256 scalingFactorTokenOut;
        uint256 swapFeeComplement;
        {
            bytes32 tokenInState = _getTokenState(request.tokenIn);
            bytes32 tokenOutState = _getTokenState(request.tokenOut);

            uint256 weightChangeProgress = ManagedPoolStorageLib.getGradualWeightChangeProgress(poolState);
            tokenInWeight = ManagedPoolTokenLib.getTokenWeight(tokenInState, weightChangeProgress);
            tokenOutWeight = ManagedPoolTokenLib.getTokenWeight(tokenOutState, weightChangeProgress);

            scalingFactorTokenIn = ManagedPoolTokenLib.getTokenScalingFactor(tokenInState);
            scalingFactorTokenOut = ManagedPoolTokenLib.getTokenScalingFactor(tokenOutState);

            swapFeeComplement = ManagedPoolStorageLib.getSwapFeePercentage(poolState).complement();
        }

        balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
        balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);

        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            // All token amounts are upscaled.
            request.amount = _upscale(request.amount, scalingFactorTokenIn);

            // We round the amount in down (favoring a higher fee amount).
            request.amount = request.amount.mulDown(swapFeeComplement);

            uint256 amountOut = WeightedMath._calcOutGivenIn(
                balanceTokenIn,
                tokenInWeight,
                balanceTokenOut,
                tokenOutWeight,
                request.amount
            );

            // amountOut tokens are exiting the Pool, so we round down.
            return _downscaleDown(amountOut, scalingFactorTokenOut);
        } else {
            // All token amounts are upscaled.
            request.amount = _upscale(request.amount, scalingFactorTokenOut);

            uint256 amountIn = WeightedMath._calcInGivenOut(
                balanceTokenIn,
                tokenInWeight,
                balanceTokenOut,
                tokenOutWeight,
                request.amount
            );

            // We round the amount in up (favoring a higher fee amount).
            amountIn = amountIn.divUp(swapFeeComplement);

            // amountIn tokens are entering the Pool, so we round up.
            return _downscaleUp(amountIn, scalingFactorTokenIn);
        }
    }

    /**
     * @dev Called before any join or exit operation. Returns the Pool's total supply by default, but derived contracts
     * may choose to add custom behavior at these steps. This often has to do with protocol fee processing.
     */
    function _beforeJoinExit(uint256 virtualSupply) internal returns (uint256) {
        // The AUM fee calculation is based on inflating the Pool's BPT supply by a target rate.
        // We then must collect AUM fees whenever joining or exiting the pool to ensure that LPs only pay AUM fees
        // for the period during which they are an LP within the pool: otherwise an LP could shift their share of the
        // AUM fees onto the remaining LPs in the pool by exiting before they were paid.
        (uint256 protocolAUMFees, uint256 managerAUMFees) = _collectAumManagementFees(virtualSupply);

        return virtualSupply.add(protocolAUMFees + managerAUMFees);
    }

    // Initialize

    function _onInitializePool(address sender, bytes memory userData)
        internal
        override
        returns (uint256, uint256[] memory)
    {
        // Check allowlist for LPs, if applicable
        _require(isAllowedAddress(sender), Errors.ADDRESS_NOT_ALLOWLISTED);

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

        // BasePool will mint bptAmountOut for the sender: we then also mint the remaining BPT to make up the total
        // supply, and have the Vault pull those tokens from the sender as part of the join.
        // We are only minting half of the maximum value - already an amount many orders of magnitude greater than any
        // conceivable real liquidity - to allow for minting new BPT as a result of regular joins.
        //
        // Note that the sender need not approve BPT for the Vault as the Vault already has infinite BPT allowance for
        // all accounts.
        uint256 initialBpt = _PREMINTED_TOKEN_BALANCE.sub(bptAmountOut);
        _mintPoolTokens(sender, initialBpt);

        // The Vault expects an array of amounts which includes BPT (which always sits in the first position).
        // We then add an extra element to the beginning of the array and set it to `initialBpt`
        amountsIn = ComposablePoolLib.prependZeroElement(amountsIn);
        amountsIn[0] = initialBpt;

        return (bptAmountOut, amountsIn);
    }

    // Join

    function _onJoinPool(
        address sender,
        uint256[] memory balances,
        bytes memory userData
    ) internal virtual override returns (uint256 bptAmountOut, uint256[] memory amountsIn) {
        // The Vault passes an array of balances which includes the pool's BPT (This always sits in the first position).
        // We want to separate this from the other balances before continuing with the join.
        uint256 virtualSupply;
        (virtualSupply, balances) = ComposablePoolLib.dropBptFromBalances(totalSupply(), balances);

        (IERC20[] memory tokens, ) = _getPoolTokens();
        uint256[] memory scalingFactors = _scalingFactors(tokens);
        _upscaleArray(balances, scalingFactors);

        uint256 preJoinExitSupply = _beforeJoinExit(virtualSupply);

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

        // The Vault expects an array of amounts which includes BPT so prepend an empty element to this array.
        amountsIn = ComposablePoolLib.prependZeroElement(amountsIn);
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
        // The Vault passes an array of balances which includes the pool's BPT (This always sits in the first position).
        // We want to separate this from the other balances before continuing with the exit.
        uint256 virtualSupply;
        (virtualSupply, balances) = ComposablePoolLib.dropBptFromBalances(totalSupply(), balances);

        (IERC20[] memory tokens, ) = _getPoolTokens();

        uint256[] memory scalingFactors = _scalingFactors(tokens);
        _upscaleArray(balances, scalingFactors);

        uint256 preJoinExitSupply = _beforeJoinExit(virtualSupply);

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

        // The Vault expects an array of amounts which includes BPT so prepend an empty element to this array.
        amountsOut = ComposablePoolLib.prependZeroElement(amountsOut);
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

    /**
     * @notice Returns the tokens in the Pool and their current balances.
     * @dev This function drops the BPT token and its balance from the returned arrays as these values are unused by
     * internal functions outside of the swap/join/exit hooks.
     */
    function _getPoolTokens() internal view override returns (IERC20[] memory, uint256[] memory) {
        (IERC20[] memory registeredTokens, uint256[] memory registeredBalances, ) = getVault().getPoolTokens(
            getPoolId()
        );

        return ComposablePoolLib.dropBpt(registeredTokens, registeredBalances);
    }

    // Unimplemented

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
}
