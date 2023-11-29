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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/IVersion.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRecoveryModeHelper.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-weighted/IExternalWeightedMath.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";

import "@balancer-labs/v2-pool-utils/contracts/lib/BasePoolMath.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/ComposablePoolLib.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/PoolRegistrationLib.sol";

import "./ManagedPoolSettings.sol";
import "./ManagedPoolAmmLib.sol";

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
contract ManagedPool is IVersion, ManagedPoolSettings {
    // ManagedPool weights and swap fees can change over time: these periods are expected to be long enough (e.g. days)
    // that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;
    using BasePoolUserData for bytes;
    using WeightedPoolUserData for bytes;

    // The maximum imposed by the Vault, which stores balances in a packed format, is 2**(112) - 1.
    // We are only minting half of the maximum value - already an amount many orders of magnitude greater than any
    // conceivable real liquidity - to allow for minting new BPT as a result of regular joins.
    uint256 private constant _PREMINTED_TOKEN_BALANCE = 2**(111);
    IExternalWeightedMath private immutable _weightedMath;
    IRecoveryModeHelper private immutable _recoveryModeHelper;
    string private _version;

    struct ManagedPoolParams {
        string name;
        string symbol;
        address[] assetManagers;
    }

    struct ManagedPoolConfigParams {
        IVault vault;
        IProtocolFeePercentagesProvider protocolFeeProvider;
        IExternalWeightedMath weightedMath;
        IRecoveryModeHelper recoveryModeHelper;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        string version;
    }

    constructor(
        ManagedPoolParams memory params,
        ManagedPoolConfigParams memory configParams,
        ManagedPoolSettingsParams memory settingsParams,
        address owner
    )
        NewBasePool(
            configParams.vault,
            PoolRegistrationLib.registerComposablePool(
                configParams.vault,
                IVault.PoolSpecialization.MINIMAL_SWAP_INFO,
                settingsParams.tokens,
                params.assetManagers
            ),
            params.name,
            params.symbol,
            configParams.pauseWindowDuration,
            configParams.bufferPeriodDuration,
            owner
        )
        ManagedPoolSettings(settingsParams, configParams.protocolFeeProvider)
    {
        _weightedMath = configParams.weightedMath;
        _recoveryModeHelper = configParams.recoveryModeHelper;
        _version = configParams.version;
    }

    function version() external view override returns (string memory) {
        return _version;
    }

    function _getWeightedMath() internal view returns (IExternalWeightedMath) {
        return _weightedMath;
    }

    function _getRecoveryModeHelper() internal view returns (IRecoveryModeHelper) {
        return _recoveryModeHelper;
    }

    // Virtual Supply

    /**
     * @notice Returns the number of tokens in circulation.
     * @dev In other pools, this would be the same as `totalSupply`, but since this pool pre-mints BPT and holds it in
     * the Vault as a token, we need to subtract the Vault's balance to get the total "circulating supply". Both the
     * totalSupply and Vault balance can change. If users join or exit using swaps, some of the preminted BPT are
     * exchanged, so the Vault's balance increases after joins and decreases after exits. If users call the recovery
     * mode exit function, the totalSupply can change as BPT are burned.
     *
     * The virtual supply can also be calculated by calling ComposablePoolLib.dropBptFromBalances with appropriate
     * inputs, which is the preferred approach whenever possible, as it avoids extra calls to the Vault.
     */
    function _getVirtualSupply() internal view override returns (uint256) {
        (uint256 cash, uint256 managed, , ) = getVault().getPoolTokenInfo(getPoolId(), IERC20(this));
        // We don't need to use SafeMath here as the Vault restricts token balances to be less than 2**112.
        // This ensures that `cash + managed` cannot overflow and the Pool's balance of BPT cannot exceed the total
        // supply so we cannot underflow either.
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
    ) internal override returns (uint256) {
        bytes32 poolState = _getPoolState();

        // ManagedPool is a composable Pool, so a swap could be either a join swap, an exit swap, or a token swap.
        // By checking whether the incoming or outgoing token is the BPT, we can determine which kind of
        // operation we want to perform and pass it to the appropriate handler.
        //
        // We block all types of swap if swaps are disabled as a token swap is equivalent to a join swap followed by
        // an exit swap into a different token.
        _require(ManagedPoolStorageLib.getSwapEnabled(poolState), Errors.SWAPS_DISABLED);

        if (request.tokenOut == IERC20(this)) {
            // `tokenOut` is the BPT, so this is a join swap.

            // Check allowlist for LPs, if applicable
            _require(_isAllowedAddress(poolState, request.from), Errors.ADDRESS_NOT_ALLOWLISTED);

            // This is equivalent to `_getVirtualSupply()`, but as `balanceTokenOut` is the Vault's balance of BPT
            // we can avoid querying this value again from the Vault as we do in `_getVirtualSupply()`.
            uint256 virtualSupply = totalSupply() - balanceTokenOut;

            // See documentation for `getActualSupply()` and `_collectAumManagementFees()`.
            uint256 actualSupply = virtualSupply + _collectAumManagementFees(virtualSupply);

            return _onJoinSwap(request, balanceTokenIn, actualSupply, poolState);
        } else if (request.tokenIn == IERC20(this)) {
            // `tokenIn` is the BPT, so this is an exit swap.

            // Note that we do not check the LP allowlist here. LPs must always be able to exit the pool,
            // and enforcing the allowlist would allow the manager to perform DOS attacks on LPs.

            // This is equivalent to `_getVirtualSupply()`, but as `balanceTokenIn` is the Vault's balance of BPT
            // we can avoid querying this value again from the Vault as we do in `_getVirtualSupply()`.
            uint256 virtualSupply = totalSupply() - balanceTokenIn;

            // See documentation for `getActualSupply()` and `_collectAumManagementFees()`.
            uint256 actualSupply = virtualSupply + _collectAumManagementFees(virtualSupply);

            return _onExitSwap(request, balanceTokenOut, actualSupply, poolState);
        } else {
            // Neither token is the BPT, so this is a standard token swap.
            return _onTokenSwap(request, balanceTokenIn, balanceTokenOut, poolState);
        }
    }

    /*
     * @dev Called when a swap with the Pool occurs, where the tokens leaving the Pool are BPT.
     *
     * This function is responsible for upscaling any amounts received, in particular `balanceTokenIn`
     * and `request.amount`.
     *
     * The return value is expected to be downscaled (appropriately rounded based on the swap type) ready to be passed
     * to the Vault.
     */
    function _onJoinSwap(
        SwapRequest memory request,
        uint256 balanceTokenIn,
        uint256 actualSupply,
        bytes32 poolState
    ) internal view returns (uint256) {
        // Check whether joins are enabled.
        _require(ManagedPoolStorageLib.getJoinExitEnabled(poolState), Errors.JOINS_EXITS_DISABLED);

        // We first query data needed to perform the joinswap, i.e. the token weight and scaling factor as well as the
        // Pool's swap fee.
        (uint256 tokenInWeight, uint256 scalingFactorTokenIn) = _getTokenInfo(
            request.tokenIn,
            ManagedPoolStorageLib.getGradualWeightChangeProgress(poolState)
        );
        uint256 swapFeePercentage = ManagedPoolStorageLib.getSwapFeePercentage(poolState);

        // `_onSwapMinimal` passes unscaled values so we upscale the token balance.
        balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);

        // We may also need to upscale `request.amount`, however we do not yet know this as that depends on whether that
        // is a token amount (GIVEN_IN) or a BPT amount (GIVEN_OUT), which gets no scaling.
        //
        // Therefore we branch depending on the swap kind and calculate the `bptAmountOut` for GIVEN_IN joinswaps or the
        // `amountIn` for GIVEN_OUT joinswaps. We call these values the `amountCalculated`.
        uint256 amountCalculated;
        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            // In `GIVEN_IN` joinswaps, `request.amount` is the amount of tokens entering the pool so we upscale with
            // `scalingFactorTokenIn`.
            request.amount = _upscale(request.amount, scalingFactorTokenIn);

            // Once fees are removed we can then calculate the equivalent BPT amount.
            amountCalculated = _getWeightedMath().calcBptOutGivenExactTokenIn(
                balanceTokenIn,
                tokenInWeight,
                request.amount,
                actualSupply,
                swapFeePercentage
            );
        } else {
            // In `GIVEN_OUT` joinswaps, `request.amount` is the amount of BPT leaving the pool, which does not need any
            // scaling.
            amountCalculated = _getWeightedMath().calcTokenInGivenExactBptOut(
                balanceTokenIn,
                tokenInWeight,
                request.amount,
                actualSupply,
                swapFeePercentage
            );
        }

        // A joinswap decreases the price of the token entering the Pool and increases the price of all other tokens.
        // ManagedPool's circuit breakers prevent the tokens' prices from leaving certain bounds so we must  check that
        // we haven't tripped a breaker as a result of the joinswap.
        _checkCircuitBreakersOnJoinOrExitSwap(request, actualSupply, amountCalculated, true);

        // Finally we downscale `amountCalculated` before we return it.
        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            // BPT is leaving the Pool, which doesn't need scaling.
            return amountCalculated;
        } else {
            // `amountCalculated` tokens are entering the Pool, so we round up.
            return _downscaleUp(amountCalculated, scalingFactorTokenIn);
        }
    }

    /*
     * @dev Called when a swap with the Pool occurs, where the tokens entering the Pool are BPT.
     *
     * This function is responsible for upscaling any amounts received, in particular `balanceTokenOut`
     * and `request.amount`.
     *
     * The return value is expected to be downscaled (appropriately rounded based on the swap type) ready to be passed
     * to the Vault.
     */
    function _onExitSwap(
        SwapRequest memory request,
        uint256 balanceTokenOut,
        uint256 actualSupply,
        bytes32 poolState
    ) internal view returns (uint256) {
        // Check whether exits are enabled.
        _require(ManagedPoolStorageLib.getJoinExitEnabled(poolState), Errors.JOINS_EXITS_DISABLED);

        // We first query data needed to perform the exitswap, i.e. the token weight and scaling factor as well as the
        // Pool's swap fee.
        (uint256 tokenOutWeight, uint256 scalingFactorTokenOut) = _getTokenInfo(
            request.tokenOut,
            ManagedPoolStorageLib.getGradualWeightChangeProgress(poolState)
        );
        uint256 swapFeePercentage = ManagedPoolStorageLib.getSwapFeePercentage(poolState);

        // `_onSwapMinimal` passes unscaled values so we upscale the token balance.
        balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);

        // We may also need to upscale `request.amount`, however we do not yet know this as that depends on whether that
        // is a BPT amount (GIVEN_IN), which gets no scaling, or a token amount (GIVEN_OUT).
        //
        // Therefore we branch depending on the swap kind and calculate the `amountOut` for GIVEN_IN exitswaps or the
        // `bptAmountIn` for GIVEN_OUT exitswaps. We call these values the `amountCalculated`.
        uint256 amountCalculated;
        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            // In `GIVEN_IN` exitswaps, `request.amount` is the amount of BPT entering the pool, which does not need any
            // scaling.
            amountCalculated = _getWeightedMath().calcTokenOutGivenExactBptIn(
                balanceTokenOut,
                tokenOutWeight,
                request.amount,
                actualSupply,
                swapFeePercentage
            );
        } else {
            // In `GIVEN_OUT` exitswaps, `request.amount` is the amount of tokens leaving the pool so we upscale with
            // `scalingFactorTokenOut`.
            request.amount = _upscale(request.amount, scalingFactorTokenOut);

            amountCalculated = _getWeightedMath().calcBptInGivenExactTokenOut(
                balanceTokenOut,
                tokenOutWeight,
                request.amount,
                actualSupply,
                swapFeePercentage
            );
        }

        // A exitswap increases the price of the token leaving the Pool and decreases the price of all other tokens.
        // ManagedPool's circuit breakers prevent the tokens' prices from leaving certain bounds so we must  check that
        // we haven't tripped a breaker as a result of the exitswap.
        _checkCircuitBreakersOnJoinOrExitSwap(request, actualSupply, amountCalculated, false);

        // Finally we downscale `amountCalculated` before we return it.
        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            // `amountCalculated` tokens are exiting the Pool, so we round down.
            return _downscaleDown(amountCalculated, scalingFactorTokenOut);
        } else {
            // BPT is entering the Pool, which doesn't need scaling.
            return amountCalculated;
        }
    }

    // Holds information for the tokens involved in a regular swap.
    struct SwapTokenData {
        uint256 tokenInWeight;
        uint256 tokenOutWeight;
        uint256 scalingFactorTokenIn;
        uint256 scalingFactorTokenOut;
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
        // We first query data needed to perform the swap, i.e. token weights and scaling factors as well as the Pool's
        // swap fee (in the form of its complement).
        SwapTokenData memory tokenData = _getSwapTokenData(request, poolState);
        uint256 swapFeeComplement = ManagedPoolStorageLib.getSwapFeePercentage(poolState).complement();

        // `_onSwapMinimal` passes unscaled values so we upscale token balances using the appropriate scaling factors.
        balanceTokenIn = _upscale(balanceTokenIn, tokenData.scalingFactorTokenIn);
        balanceTokenOut = _upscale(balanceTokenOut, tokenData.scalingFactorTokenOut);

        // We must also upscale `request.amount` however we do not yet know which scaling factor to use as this differs
        // depending on whether it represents an amount of tokens entering (GIVEN_IN) or leaving (GIVEN_OUT) the Pool.
        //
        // Therefore we branch depending on the swap kind and calculate the `amountOut` for GIVEN_IN swaps or the
        // `amountIn` for GIVEN_OUT swaps. We call these values the `amountCalculated`.
        uint256 amountCalculated;
        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            // In `GIVEN_IN` swaps, `request.amount` is the amount of tokens entering the pool so we upscale with
            // `scalingFactorTokenIn`.
            request.amount = _upscale(request.amount, tokenData.scalingFactorTokenIn);

            // We then subtract swap fees from this amount so the collected swap fees aren't use to calculate how many
            // tokens the trader will receive. We round this value down (favoring a higher fee amount).
            uint256 amountInMinusFees = request.amount.mulDown(swapFeeComplement);

            // Once fees are removed we can then calculate the equivalent amount of `tokenOut`.
            amountCalculated = _getWeightedMath().calcOutGivenIn(
                balanceTokenIn,
                tokenData.tokenInWeight,
                balanceTokenOut,
                tokenData.tokenOutWeight,
                amountInMinusFees
            );
        } else {
            // In `GIVEN_OUT` swaps, `request.amount` is the amount of tokens leaving the pool so we upscale with
            // `scalingFactorTokenOut`.
            request.amount = _upscale(request.amount, tokenData.scalingFactorTokenOut);

            // We first calculate how many tokens must be sent in order to receive `request.amount` tokens out.
            // This calculation does not yet include fees.
            uint256 amountInMinusFees = _getWeightedMath().calcInGivenOut(
                balanceTokenIn,
                tokenData.tokenInWeight,
                balanceTokenOut,
                tokenData.tokenOutWeight,
                request.amount
            );

            // We then add swap fees to this amount so the trader must send extra tokens.
            // We round this value up (favoring a higher fee amount).
            amountCalculated = amountInMinusFees.divUp(swapFeeComplement);
        }

        // A token swap increases the price of the token leaving the Pool and reduces the price of the token entering
        // the Pool. ManagedPool's circuit breakers prevent the tokens' prices from leaving certain bounds so we must
        // check that we haven't tripped a breaker as a result of the token swap.
        _checkCircuitBreakersOnRegularSwap(request, tokenData, balanceTokenIn, balanceTokenOut, amountCalculated);

        // Finally we downscale `amountCalculated` before we return it. We want to round this value in favour of the
        // Pool so apply different scaling on amounts entering or leaving the Pool.
        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            // `amountCalculated` tokens are exiting the Pool, so we round down.
            return _downscaleDown(amountCalculated, tokenData.scalingFactorTokenOut);
        } else {
            // `amountCalculated` tokens are entering the Pool, so we round up.
            return _downscaleUp(amountCalculated, tokenData.scalingFactorTokenIn);
        }
    }

    /**
     * @dev Gather the information required to process a regular token swap. This is required to avoid stack-too-deep
     * issues.
     */
    function _getSwapTokenData(SwapRequest memory request, bytes32 poolState)
        private
        view
        returns (SwapTokenData memory tokenInfo)
    {
        bytes32 tokenInState = _getTokenState(request.tokenIn);
        bytes32 tokenOutState = _getTokenState(request.tokenOut);

        uint256 weightChangeProgress = ManagedPoolStorageLib.getGradualWeightChangeProgress(poolState);
        tokenInfo.tokenInWeight = ManagedPoolTokenStorageLib.getTokenWeight(tokenInState, weightChangeProgress);
        tokenInfo.tokenOutWeight = ManagedPoolTokenStorageLib.getTokenWeight(tokenOutState, weightChangeProgress);

        tokenInfo.scalingFactorTokenIn = ManagedPoolTokenStorageLib.getTokenScalingFactor(tokenInState);
        tokenInfo.scalingFactorTokenOut = ManagedPoolTokenStorageLib.getTokenScalingFactor(tokenOutState);
    }

    /**
     * @notice Returns a token's weight and scaling factor
     */
    function _getTokenInfo(IERC20 token, uint256 weightChangeProgress)
        private
        view
        returns (uint256 tokenWeight, uint256 scalingFactor)
    {
        bytes32 tokenState = _getTokenState(token);
        tokenWeight = ManagedPoolTokenStorageLib.getTokenWeight(tokenState, weightChangeProgress);
        scalingFactor = ManagedPoolTokenStorageLib.getTokenScalingFactor(tokenState);
    }

    // Initialize

    function _onInitializePool(
        address sender,
        address,
        bytes memory userData
    ) internal override returns (uint256 bptAmountOut, uint256[] memory amountsIn) {
        // Check allowlist for LPs, if applicable
        _require(_isAllowedAddress(_getPoolState(), sender), Errors.ADDRESS_NOT_ALLOWLISTED);

        // Ensure that the user intends to initialize the Pool.
        WeightedPoolUserData.JoinKind kind = userData.joinKind();
        _require(kind == WeightedPoolUserData.JoinKind.INIT, Errors.UNINITIALIZED);

        // Extract the initial token balances `sender` is sending to the Pool.
        (IERC20[] memory tokens, ) = _getPoolTokens();
        amountsIn = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsIn.length, tokens.length);

        // We now want to determine the correct amount of BPT to mint in return for these tokens.
        // In order to do this we calculate the Pool's invariant which requires the token amounts to be upscaled.
        uint256[] memory scalingFactors = _scalingFactors(tokens);
        _upscaleArray(amountsIn, scalingFactors);

        uint256 invariantAfterJoin = _getWeightedMath().calculateInvariant(_getNormalizedWeights(tokens), amountsIn);

        // Set the initial BPT to the value of the invariant times the number of tokens. This makes BPT supply more
        // consistent in Pools with similar compositions but different number of tokens.
        bptAmountOut = Math.mul(invariantAfterJoin, amountsIn.length);

        // We don't need upscaled balances anymore and will need to return downscaled amounts so we downscale here.
        // `amountsIn` are amounts entering the Pool, so we round up when doing this.
        _downscaleUpArray(amountsIn, scalingFactors);

        // BasePool will mint `bptAmountOut` for the sender: we then also mint the remaining BPT to make up the total
        // supply, and have the Vault pull those tokens from the sender as part of the join.
        //
        // Note that the sender need not approve BPT for the Vault as the Vault already has infinite BPT allowance for
        // all accounts.
        uint256 initialBpt = _PREMINTED_TOKEN_BALANCE.sub(bptAmountOut);
        _mintPoolTokens(sender, initialBpt);

        // The Vault expects an array of amounts which includes BPT (which always sits in the first position).
        // We then add an extra element to the beginning of the array and set it to `initialBpt`.
        amountsIn = ComposablePoolLib.prependZeroElement(amountsIn);
        amountsIn[0] = initialBpt;

        // At this point we have all necessary return values for the initialization.

        // Finally, we want to start collecting AUM fees from this point onwards. Prior to initialization the Pool holds
        // no funds so naturally charges no AUM fees.
        _updateAumFeeCollectionTimestamp();
    }

    // Join

    function _onJoinPool(
        address sender,
        uint256[] memory balances,
        bytes memory userData
    ) internal virtual override returns (uint256 bptAmountOut, uint256[] memory amountsIn) {
        bytes32 poolState = _getPoolState();

        _require(_isAllowedAddress(poolState, sender), Errors.ADDRESS_NOT_ALLOWLISTED);

        // The Vault passes an array of balances which includes the pool's BPT (This always sits in the first position).
        // We want to separate this from the other balances before continuing with the join.
        uint256 virtualSupply;
        (virtualSupply, balances) = ComposablePoolLib.dropBptFromBalances(totalSupply(), balances);

        (IERC20[] memory tokens, ) = _getPoolTokens();

        uint256 actualSupply = virtualSupply + _collectAumManagementFees(virtualSupply);

        return
            ManagedPoolAmmLib.joinPool(
                balances,
                userData,
                actualSupply,
                _scalingFactors(tokens),
                _getNormalizedWeights(tokens),
                poolState,
                _getCircuitBreakerStates(tokens),
                _getWeightedMath()
            );
    }

    // Exit

    function _onExitPool(
        address,
        uint256[] memory balances,
        bytes memory userData
    ) internal virtual override returns (uint256 bptAmountIn, uint256[] memory amountsOut) {
        uint256 virtualSupply;
        (virtualSupply, balances) = ComposablePoolLib.dropBptFromBalances(totalSupply(), balances);

        (IERC20[] memory tokens, ) = _getPoolTokens();

        uint256 actualSupply = virtualSupply + _collectAumManagementFees(virtualSupply);

        return
            ManagedPoolAmmLib.exitPool(
                balances,
                userData,
                actualSupply,
                _scalingFactors(tokens),
                _getNormalizedWeights(tokens),
                _getPoolState(),
                _getCircuitBreakerStates(tokens),
                _getWeightedMath()
            );
    }

    function _getCircuitBreakerStates(IERC20[] memory tokens)
        private
        view
        returns (bytes32[] memory circuitBreakerStates)
    {
        circuitBreakerStates = new bytes32[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            circuitBreakerStates[i] = _getCircuitBreakerState(tokens[i]);
        }
    }

    function _doRecoveryModeExit(
        uint256[] memory,
        uint256 totalSupply,
        bytes memory userData
    ) internal view override returns (uint256, uint256[] memory) {
        return _getRecoveryModeHelper().calcComposableRecoveryAmountsOut(getPoolId(), userData, totalSupply);
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

    // Circuit Breakers

    /**
     * @dev Check the circuit breakers of the two tokens involved in a regular swap.
     */
    function _checkCircuitBreakersOnRegularSwap(
        SwapRequest memory request,
        SwapTokenData memory tokenData,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 amountCalculated
    ) private view {
        uint256 actualSupply = _getActualSupply(_getVirtualSupply());

        (uint256 amountIn, uint256 amountOut) = request.kind == IVault.SwapKind.GIVEN_IN
            ? (request.amount, amountCalculated)
            : (amountCalculated, request.amount);

        // Since the balance of tokenIn is increasing, its BPT price will decrease,
        // so we need to check the lower bound.
        ManagedPoolAmmLib.checkCircuitBreaker(
            ManagedPoolAmmLib.BoundCheckKind.LOWER,
            _getCircuitBreakerState(request.tokenIn),
            actualSupply,
            balanceTokenIn.add(amountIn),
            tokenData.tokenInWeight
        );

        // Since the balance of tokenOut is decreasing, its BPT price will increase,
        // so we need to check the upper bound.
        ManagedPoolAmmLib.checkCircuitBreaker(
            ManagedPoolAmmLib.BoundCheckKind.UPPER,
            _getCircuitBreakerState(request.tokenOut),
            actualSupply,
            balanceTokenOut.sub(amountOut),
            tokenData.tokenOutWeight
        );
    }

    /**
     * @dev We need to check the breakers for all tokens on joins and exits (including join and exit swaps), since any
     * change to the BPT supply affects all BPT prices. For a multi-token join or exit, we will have a set of
     * balances and amounts. For a join/exitSwap, only one token balance is changing. We can use the same data for
     *  both: in the single token swap case, the other token `amounts` will be zero.
     */
    function _checkCircuitBreakersOnJoinOrExitSwap(
        SwapRequest memory request,
        uint256 actualSupply,
        uint256 amountCalculated,
        bool isJoin
    ) private view {
        uint256 newActualSupply;
        uint256 amount;

        // This is a swap between the BPT token and another pool token. Calculate the end state: actualSupply
        // and the token amount being swapped, depending on whether it is a join or exit, GivenIn or GivenOut.
        if (isJoin) {
            (newActualSupply, amount) = request.kind == IVault.SwapKind.GIVEN_IN
                ? (actualSupply.add(amountCalculated), request.amount)
                : (actualSupply.add(request.amount), amountCalculated);
        } else {
            (newActualSupply, amount) = request.kind == IVault.SwapKind.GIVEN_IN
                ? (actualSupply.sub(request.amount), amountCalculated)
                : (actualSupply.sub(amountCalculated), request.amount);
        }

        // Since this is a swap, we do not have all the tokens, balances, or weights, and need to fetch them.
        (IERC20[] memory tokens, uint256[] memory balances) = _getPoolTokens();
        uint256[] memory normalizedWeights = _getNormalizedWeights(tokens);
        _upscaleArray(balances, _scalingFactors(tokens));

        // Initialize to all zeros, and set the amount associated with the swap.
        uint256[] memory amounts = new uint256[](tokens.length);
        IERC20 token = isJoin ? request.tokenIn : request.tokenOut;

        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == token) {
                amounts[i] = amount;
                break;
            }
        }

        ManagedPoolAmmLib.checkCircuitBreakers(
            newActualSupply,
            _getCircuitBreakerStates(tokens),
            balances,
            amounts,
            normalizedWeights,
            isJoin
        );
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
