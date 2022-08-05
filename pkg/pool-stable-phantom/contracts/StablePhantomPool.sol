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

import "@balancer-labs/v2-interfaces/contracts/pool-stable-phantom/StablePhantomPoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolFeePercentagesProvider.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";

import "@balancer-labs/v2-pool-utils/contracts/BaseGeneralPool.sol";
import "@balancer-labs/v2-pool-utils/contracts/rates/PriceRateCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/ProtocolFeeCache.sol";

import "./StablePoolAmplification.sol";
import "./StablePoolStorage.sol";
import "./StablePoolRates.sol";
import "./StableMath.sol";

/**
 * @dev StablePool with preminted BPT and rate providers for each token, allowing for e.g. wrapped tokens with a known
 * price ratio, such as Compound's cTokens.
 *
 * BPT is preminted on Pool initialization and registered as one of the Pool's tokens, allowing for swaps to behave as
 * single-token joins or exits (by swapping a token for BPT). We also support regular joins and exits, which can mint
 * and burn BPT.
 *
 * Preminted BPT is sometimes called Phantom BPT, as the preminted BPT (which is deposited in the Vault as balance of
 * the Pool) doesn't belong to any entity until transferred out of the Pool. The Pool's arithmetic behaves as if it
 * didn't exist, and the BPT total supply is not a useful value: we rely on the 'virtual supply' (how much BPT is
 * actually owned outside the Vault) instead.
 */
contract StablePhantomPool is
    IRateProvider,
    BaseGeneralPool,
    StablePoolAmplification,
    StablePoolRates,
    ProtocolFeeCache
{
    using FixedPoint for uint256;
    using PriceRateCache for bytes32;
    using StablePhantomPoolUserData for bytes;
    using BasePoolUserData for bytes;

    // The maximum imposed by the Vault, which stores balances in a packed format, is 2**(112) - 1.
    // We are preminting half of that value (rounded up).
    uint256 private constant _PREMINTED_TOKEN_BALANCE = 2**(111);

    // This contract uses timestamps to slowly update its Amplification parameter over time. These changes must occur
    // over a minimum time period much larger than the blocktime, making timestamp manipulation a non-issue.
    // solhint-disable not-rely-on-time

    // To track protocol fees, we measure and store the value of the invariant after every join and exit.
    // All invariant growth that happens between join and exit events is due to swap fees and yield.
    // For selected tokens, we exclude the yield portion from the computation.
    uint256 private _postJoinExitInvariant;

    // Because the invariant depends on the amplification parameter, and this value may change over time, we should only
    // compare invariants that were computed using the same value. We therefore store `_postJoinExitAmp` whenever we
    // store `_postJoinExitInvariant`.
    uint256 private _postJoinExitAmp;

    // The constructor arguments are received in a struct to work around stack-too-deep issues
    struct NewPoolParams {
        IVault vault;
        IProtocolFeePercentagesProvider protocolFeeProvider;
        string name;
        string symbol;
        IERC20[] tokens;
        IRateProvider[] rateProviders;
        uint256[] tokenRateCacheDurations;
        bool[] exemptFromYieldProtocolFeeFlags;
        uint256 amplificationParameter;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        address owner;
    }

    constructor(NewPoolParams memory params)
        BasePool(
            params.vault,
            IVault.PoolSpecialization.GENERAL,
            params.name,
            params.symbol,
            _insertSorted(params.tokens, IERC20(this)),
            new address[](params.tokens.length + 1),
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
        StablePoolAmplification(params.amplificationParameter)
        StablePoolStorage(_extractStorageParams(params))
        StablePoolRates(_extractRatesParams(params))
        ProtocolFeeCache(params.protocolFeeProvider, ProtocolFeeCache.DELEGATE_PROTOCOL_SWAP_FEES_SENTINEL)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    // Translate parameters to avoid stack-too-deep issues in the constructor
    function _extractRatesParams(NewPoolParams memory params)
        private
        pure
        returns (StablePoolRates.RatesParams memory)
    {
        return StablePoolRates.RatesParams(params.tokens, params.rateProviders, params.tokenRateCacheDurations);
    }

    // Translate parameters to avoid stack-too-deep issues in the constructor
    function _extractStorageParams(NewPoolParams memory params)
        private
        view
        returns (StablePoolStorage.StorageParams memory)
    {
        return
            StablePoolStorage.StorageParams(
                _insertSorted(params.tokens, IERC20(this)),
                params.rateProviders,
                params.exemptFromYieldProtocolFeeFlags
            );
    }

    /**
     * @notice Return the minimum BPT balance, required to avoid minimum token balances.
     * @dev This amount is minted and immediately burned on pool initialization, so that the total supply
     * (and therefore post-exit token balances), can never be zero. This keeps the math well-behaved when
     * liquidity is low. (It also provides an easy way to check whether a pool has been initialized, to
     * ensure this is only done once.)
     */
    function getMinimumBpt() external pure returns (uint256) {
        return _getMinimumBpt();
    }

    // BasePool hook

    /**
     * @dev Override base pool hook invoked before any swap, join, or exit to ensure rates are updated before
     * the operation.
     */
    function _beforeSwapJoinExit() internal override {
        super._beforeSwapJoinExit();

        // Before the scaling factors are read, we must update the cached rates, as those will be used to compute the
        // scaling factors.
        // Note that this is not done in a recovery mode exit (since _beforeSwapjoinExit() is not called under those
        // conditions), but this is fine as recovery mode exits are unaffected by scaling factors anyway.
        _cacheTokenRatesIfNecessary();
    }

    // Swap Hooks

    /**
     * @dev Override this hook called by the base class `onSwap`, to check whether we are doing a regular swap,
     * or a swap involving BPT, which is equivalent to a single token join or exit. Since one of the Pool's
     * tokens is the preminted BPT, we need to handle swaps where BPT is involved separately.
     *
     * At this point, the balances are unscaled.
     *
     * If this is a swap involving BPT, call `_swapWithBpt`, which computes the amountOut using the swapFeePercentage
     * and charges protocol fees, in the same manner as single token join/exits. Otherwise, perform the default
     * processing for a regular swap.
     */
    function _swapGivenIn(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut,
        uint256[] memory scalingFactors
    ) internal virtual override whenNotPaused returns (uint256) {
        return
            (swapRequest.tokenIn == IERC20(this) || swapRequest.tokenOut == IERC20(this))
                ? _swapWithBpt(swapRequest, balances, indexIn, indexOut, scalingFactors)
                : super._swapGivenIn(swapRequest, balances, indexIn, indexOut, scalingFactors);
    }

    /**
     * @dev Override this hook called by the base class `onSwap`, to check whether we are doing a regular swap,
     * or a swap involving BPT, which is equivalent to a single token join or exit. Since one of the Pool's
     * tokens is the preminted BPT, we need to handle swaps where BPT is involved separately.
     *
     * At this point, the balances are unscaled.
     *
     * If this is a swap involving BPT, call `_swapWithBpt`, which computes the amountOut using the swapFeePercentage
     * and charges protocol fees, in the same manner as single token join/exits. Otherwise, perform the default
     * processing for a regular swap.
     */
    function _swapGivenOut(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut,
        uint256[] memory scalingFactors
    ) internal virtual override whenNotPaused returns (uint256) {
        return
            (swapRequest.tokenIn == IERC20(this) || swapRequest.tokenOut == IERC20(this))
                ? _swapWithBpt(swapRequest, balances, indexIn, indexOut, scalingFactors)
                : super._swapGivenOut(swapRequest, balances, indexIn, indexOut, scalingFactors);
    }

    /**
     * @dev This is called from the base class `_swapGivenIn`, so at this point the amount has been adjusted
     * for swap fees, and balances have had scaling applied. This will only be called for regular (non-BPT) swaps,
     * so forward to `onRegularSwap`.
     */
    function _onSwapGivenIn(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override returns (uint256 amountOut) {
        return _onRegularSwap(IVault.SwapKind.GIVEN_IN, request.amount, balancesIncludingBpt, indexIn, indexOut);
    }

    /**
     * @dev This is called from the base class `_swapGivenOut`, so at this point the amount has been adjusted
     * for swap fees, and balances have had scaling applied. This will only be called for regular (non-BPT) swaps,
     * so forward to `onRegularSwap`.
     */
    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override returns (uint256 amountIn) {
        return _onRegularSwap(IVault.SwapKind.GIVEN_OUT, request.amount, balancesIncludingBpt, indexIn, indexOut);
    }

    /**
     * @dev Perform a swap between non-BPT tokens. Scaling and fee adjustments have been performed upstream, so
     * all we need to do here is calculate the price quote, depending on the direction of the swap.
     */
    function _onRegularSwap(
        IVault.SwapKind kind,
        uint256 amountGiven,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) private view returns (uint256) {
        uint256[] memory balances = _dropBptItem(balancesIncludingBpt);
        (uint256 currentAmp, ) = _getAmplificationParameter();
        uint256 invariant = StableMath._calculateInvariant(currentAmp, balances);

        // Adjust indices for BPT token
        indexIn = _skipBptIndex(indexIn);
        indexOut = _skipBptIndex(indexOut);

        if (kind == IVault.SwapKind.GIVEN_IN) {
            return StableMath._calcOutGivenIn(currentAmp, balances, indexIn, indexOut, amountGiven, invariant);
        } else {
            return StableMath._calcInGivenOut(currentAmp, balances, indexIn, indexOut, amountGiven, invariant);
        }
    }

    /**
     * @dev Perform a swap involving the BPT token, equivalent to a single-token join or exit. As with the standard
     * joins and swaps, we first pay any protocol fees pending from swaps that occurred since the previous join or
     * exit, then perform the operation (joinSwap or exitSwap), and finally store the "post operation" invariant and
     * amp, which establishes the new basis for protocol fees.
     *
     * At this point, the scaling factors (including rates) have been computed by the base class, but not yet applied
     * to the balances.
     */
    function _swapWithBpt(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut,
        uint256[] memory scalingFactors
    ) private returns (uint256) {
        bool isGivenIn = swapRequest.kind == IVault.SwapKind.GIVEN_IN;

        _upscaleArray(balances, scalingFactors);
        swapRequest.amount = _upscale(swapRequest.amount, scalingFactors[isGivenIn ? indexIn : indexOut]);

        (uint256 preJoinExitSupply, uint256[] memory balancesWithoutBpt) = _payProtocolFeesBeforeJoinExit(balances);
        (uint256 currentAmp, ) = _getAmplificationParameter();

        uint256 preJoinExitInvariant = StableMath._calculateInvariant(currentAmp, balancesWithoutBpt);

        (uint256 amountCalculated, uint256 postJoinExitSupply) = indexOut == getBptIndex()
            ? _doJoinSwap(
                isGivenIn,
                swapRequest.amount,
                balancesWithoutBpt,
                _skipBptIndex(indexIn),
                currentAmp,
                preJoinExitSupply,
                preJoinExitInvariant
            )
            : _doExitSwap(
                isGivenIn,
                swapRequest.amount,
                balancesWithoutBpt,
                _skipBptIndex(indexOut),
                currentAmp,
                preJoinExitSupply,
                preJoinExitInvariant
            );

        _updateInvariantAfterJoinExit(
            currentAmp,
            balancesWithoutBpt,
            preJoinExitInvariant,
            preJoinExitSupply,
            postJoinExitSupply
        );

        return
            isGivenIn
                ? _downscaleDown(amountCalculated, scalingFactors[indexOut])
                : _downscaleUp(amountCalculated, scalingFactors[indexIn]);
    }

    /**
     * @dev This mutates balancesWithoutBpt so that they become the post-joinswap balances. The StableMath interfaces
     * are different depending on the swap direction, so we forward to the appropriate low-level join function.
     */
    function _doJoinSwap(
        bool isGivenIn,
        uint256 amount,
        uint256[] memory balancesWithoutBpt,
        uint256 indexIn,
        uint256 currentAmp,
        uint256 virtualSupply,
        uint256 preJoinExitInvariant
    ) internal view returns (uint256, uint256) {
        return
            isGivenIn
                ? _joinSwapExactTokenInForBptOut(amount, balancesWithoutBpt, indexIn, currentAmp, virtualSupply, preJoinExitInvariant)
                : _joinSwapExactBptOutForTokenIn(amount, balancesWithoutBpt, indexIn, currentAmp, virtualSupply, preJoinExitInvariant);
    }

    /**
     * @dev Since this is a join, we know the tokenOut is BPT. Since it is GivenIn, we know the tokenIn amount,
     * and must calculate the BPT amount out.
     * We are moving preminted BPT out of the Vault, which increases the virtual supply.
     */
    function _joinSwapExactTokenInForBptOut(
        uint256 amountIn,
        uint256[] memory balancesWithoutBpt,
        uint256 indexIn,
        uint256 currentAmp,
        uint256 virtualSupply,
        uint256 preJoinExitInvariant
    ) internal view returns (uint256, uint256) {
        // The StableMath function was created with joins in mind, so it expects a full amounts array. We create an
        // empty one and only set the amount for the token involved.
        uint256[] memory amountsIn = new uint256[](balancesWithoutBpt.length);
        amountsIn[indexIn] = amountIn;

        uint256 bptOut = StableMath._calcBptOutGivenExactTokensIn(
            currentAmp,
            balancesWithoutBpt,
            amountsIn,
            virtualSupply,
            preJoinExitInvariant,
            getSwapFeePercentage()
        );

        balancesWithoutBpt[indexIn] += amountIn;
        uint256 postJoinExitSupply = virtualSupply + bptOut;

        return (bptOut, postJoinExitSupply);
    }

    /**
     * @dev Since this is a join, we know the tokenOut is BPT. Since it is GivenOut, we know the BPT amount,
     * and must calculate the token amount in.
     * We are moving preminted BPT out of the Vault, which increases the virtual supply.
     */
    function _joinSwapExactBptOutForTokenIn(
        uint256 bptOut,
        uint256[] memory balancesWithoutBpt,
        uint256 indexIn,
        uint256 currentAmp,
        uint256 virtualSupply,
        uint256 preJoinExitInvariant
    ) internal view returns (uint256, uint256) {
        uint256 amountIn = StableMath._calcTokenInGivenExactBptOut(
            currentAmp,
            balancesWithoutBpt,
            indexIn,
            bptOut,
            virtualSupply,
            preJoinExitInvariant,
            getSwapFeePercentage()
        );

        balancesWithoutBpt[indexIn] += amountIn;
        uint256 postJoinExitSupply = virtualSupply + bptOut;

        return (amountIn, postJoinExitSupply);
    }

    /**
     * @dev This mutates balancesWithoutBpt so that they become the post-exitswap balances. The StableMath interfaces
     * are different depending on the swap direction, so we forward to the appropriate low-level exit function.
     */
    function _doExitSwap(
        bool isGivenIn,
        uint256 amount,
        uint256[] memory balancesWithoutBpt,
        uint256 indexOut,
        uint256 currentAmp,
        uint256 virtualSupply,
        uint256 preJoinExitInvariant
    ) internal view returns (uint256, uint256) {
        return
            isGivenIn
                ? _exitSwapExactBptInForTokenOut(amount, balancesWithoutBpt, indexOut, currentAmp, virtualSupply, preJoinExitInvariant)
                : _exitSwapExactTokenOutForBptIn(amount, balancesWithoutBpt, indexOut, currentAmp, virtualSupply, preJoinExitInvariant);
    }

    /**
     * @dev Since this is an exit, we know the tokenIn is BPT. Since it is GivenIn, we know the BPT amount,
     * and must calculate the token amount out.
     * We are moving BPT out of circulation and into the Vault, which decreases the virtual supply.
     */
    function _exitSwapExactBptInForTokenOut(
        uint256 bptAmount,
        uint256[] memory balancesWithoutBpt,
        uint256 indexOut,
        uint256 currentAmp,
        uint256 virtualSupply,
        uint256 preJoinExitInvariant
    ) internal view returns (uint256, uint256) {
        uint256 amountOut = StableMath._calcTokenOutGivenExactBptIn(
            currentAmp,
            balancesWithoutBpt,
            indexOut,
            bptAmount,
            virtualSupply,
            preJoinExitInvariant,
            getSwapFeePercentage()
        );

        balancesWithoutBpt[indexOut] -= amountOut;
        uint256 postJoinExitSupply = virtualSupply - bptAmount;

        return (amountOut, postJoinExitSupply);
    }

    /**
     * @dev Since this is an exit, we know the tokenIn is BPT. Since it is GivenOut, we know the token amount out,
     * and must calculate the BPT amount in.
     * We are moving BPT out of circulation and into the Vault, which decreases the virtual supply.
     */
    function _exitSwapExactTokenOutForBptIn(
        uint256 amountOut,
        uint256[] memory balancesWithoutBpt,
        uint256 indexOut,
        uint256 currentAmp,
        uint256 virtualSupply,
        uint256 preJoinExitInvariant
    ) internal view returns (uint256, uint256) {
        // The StableMath function was created with exits in mind, so it expects a full amounts array. We create an
        // empty one and only set the amount for the token involved.
        uint256[] memory amountsOut = new uint256[](balancesWithoutBpt.length);
        amountsOut[indexOut] = amountOut;

        uint256 bptAmount = StableMath._calcBptInGivenExactTokensOut(
            currentAmp,
            balancesWithoutBpt,
            amountsOut,
            virtualSupply,
            preJoinExitInvariant,
            getSwapFeePercentage()
        );

        balancesWithoutBpt[indexOut] -= amountOut;
        uint256 postJoinExitSupply = virtualSupply - bptAmount;

        return (bptAmount, postJoinExitSupply);
    }

    // Join Hooks

    /**
     * Since this Pool has preminted BPT which is stored in the Vault, it cannot simply be minted at construction.
     *
     * We take advantage of the fact that StablePools have an initialization step where BPT is minted to the first
     * account joining them, and perform both actions at once. By minting the entire BPT supply for the initial joiner
     * and then pulling all tokens except those due the joiner, we arrive at the desired state of the Pool holding all
     * BPT except the joiner's.
     */
    function _onInitializePool(
        bytes32,
        address sender,
        address,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        StablePhantomPoolUserData.JoinKindPhantom kind = userData.joinKind();
        _require(kind == StablePhantomPoolUserData.JoinKindPhantom.INIT, Errors.UNINITIALIZED);

        // AmountsIn usually does not include the BPT token; initialization is the one time it has to.
        uint256[] memory amountsInIncludingBpt = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsInIncludingBpt.length, scalingFactors.length);
        _upscaleArray(amountsInIncludingBpt, scalingFactors);

        (uint256 amp, ) = _getAmplificationParameter();
        uint256[] memory amountsIn = _dropBptItem(amountsInIncludingBpt);
        uint256 invariantAfterJoin = StableMath._calculateInvariant(amp, amountsIn);

        // Set the initial BPT to the value of the invariant
        uint256 bptAmountOut = invariantAfterJoin;

        // BasePool will mint bptAmountOut for the sender: we then also mint the remaining BPT to make up the total
        // supply, and have the Vault pull those tokens from the sender as part of the join.
        // We are only minting half of the maximum value - already an amount many orders of magnitude greater than any
        // conceivable real liquidity - to allow for minting new BPT as a result of regular joins.
        //
        // Note that the sender need not approve BPT for the Vault as the Vault already has infinite BPT allowance for
        // all accounts.
        uint256 initialBpt = _PREMINTED_TOKEN_BALANCE.sub(bptAmountOut);

        _mintPoolTokens(sender, initialBpt);
        amountsInIncludingBpt[getBptIndex()] = initialBpt;

        // Update invariant after join
        _postJoinExitInvariant = invariantAfterJoin;
        _postJoinExitAmp = amp;

        // Initialize the OldRates
        _updateOldRates();

        return (bptAmountOut, amountsInIncludingBpt);
    }

    /**
     * @dev Base pool hook called from `onJoinPool`. Forward to `onJoinExitPool` with `isJoin` set to true.
     */
    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory balances,
        uint256,
        uint256,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        return _onJoinExitPool(true, balances, scalingFactors, userData);
    }

    /**
     * @dev Base pool hook called from `onExitPool`. Forward to `onJoinExitPool` with `isJoin` set to false.
     * Note that recovery mode exits do not call `_onExitPool`.
     */
    function _onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory balances,
        uint256,
        uint256,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        return _onJoinExitPool(false, balances, scalingFactors, userData);
    }

    /**
     * @dev Pay protocol fees before the operation, and call `_updateInvariantAfterJoinExit` afterward, to establish
     * the new basis for protocol fees.
     */
    function _onJoinExitPool(
        bool isJoin,
        uint256[] memory balances,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal returns (uint256, uint256[] memory) {
        (uint256 preJoinExitSupply, uint256[] memory balancesWithoutBpt) = _payProtocolFeesBeforeJoinExit(balances);
        (uint256 currentAmp, ) = _getAmplificationParameter();

        uint256 preJoinExitInvariant = StableMath._calculateInvariant(currentAmp, balancesWithoutBpt);


            function(uint256[] memory, uint256, uint256, uint256, uint256[] memory, bytes memory)
                internal
                view
                returns (uint256, uint256[] memory) _doJoinOrExit
         = (isJoin ? _doJoin : _doExit);

        (uint256 bptAmount, uint256[] memory amountsDelta) = _doJoinOrExit(
            balancesWithoutBpt,
            currentAmp,
            preJoinExitSupply,
            preJoinExitInvariant,
            scalingFactors,
            userData
        );

        // Unlike joinswaps, explicit joins do not mutate balancesWithoutBpt into the post join balances so we must
        // perform this mutation here.
        _mutateAmounts(balancesWithoutBpt, amountsDelta, isJoin ? FixedPoint.add : FixedPoint.sub);
        uint256 postJoinExitSupply = isJoin ? preJoinExitSupply + bptAmount : preJoinExitSupply - bptAmount;

        // Pass in the post-join balances to reset the protocol fee basis.
        // We are minting bptAmount, increasing the total (and virtual) supply post-join
        _updateInvariantAfterJoinExit(
            currentAmp,
            balancesWithoutBpt,
            preJoinExitInvariant,
            preJoinExitSupply,
            postJoinExitSupply
        );

        // For clarity and simplicity, arrays used and computed in lower level functions do not include BPT.
        // But the amountsIn array passed back to the Vault must include BPT, so we add it back in here.
        return (bptAmount, _addBptItem(amountsDelta, 0));
    }

    /**
     * @dev Support single- and multi-token joins, but not explicit proportional joins.
     */
    function _doJoin(
        uint256[] memory balancesWithoutBpt,
        uint256 currentAmp,
        uint256 preJoinExitSupply,
        uint256 preJoinExitInvariant,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal view returns (uint256, uint256[] memory) {
        StablePhantomPoolUserData.JoinKindPhantom kind = userData.joinKind();
        if (kind == StablePhantomPoolUserData.JoinKindPhantom.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return
                _joinExactTokensInForBPTOut(
                    preJoinExitSupply,
                    preJoinExitInvariant,
                    currentAmp,
                    balancesWithoutBpt,
                    scalingFactors,
                    userData
                );
        } else if (kind == StablePhantomPoolUserData.JoinKindPhantom.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return _joinTokenInForExactBPTOut(preJoinExitSupply, preJoinExitInvariant, currentAmp, balancesWithoutBpt, userData);
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    /**
     * @dev Multi-token join. Joins with proportional amounts will pay no protocol fees.
     */
    function _joinExactTokensInForBPTOut(
        uint256 virtualSupply,
        uint256 preJoinExitInvariant,
        uint256 currentAmp,
        uint256[] memory balancesWithoutBpt,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        (uint256[] memory amountsIn, uint256 minBPTAmountOut) = userData.exactTokensInForBptOut();
        InputHelpers.ensureInputLengthMatch(balancesWithoutBpt.length, amountsIn.length);

        // The user-provided amountsIn is unscaled, so we address that.
        _upscaleArray(amountsIn, _dropBptItem(scalingFactors));

        uint256 bptAmountOut = StableMath._calcBptOutGivenExactTokensIn(
            currentAmp,
            balancesWithoutBpt,
            amountsIn,
            virtualSupply,
            preJoinExitInvariant,
            getSwapFeePercentage()
        );

        _require(bptAmountOut >= minBPTAmountOut, Errors.BPT_OUT_MIN_AMOUNT);

        return (bptAmountOut, amountsIn);
    }

    /**
     * @dev Single-token join, equivalent to swapping a pool token for BPT.
     */
    function _joinTokenInForExactBPTOut(
        uint256 virtualSupply,
        uint256 preJoinExitInvariant,
        uint256 currentAmp,
        uint256[] memory balancesWithoutBpt,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        // Since this index is sent in from the user, we interpret it as NOT including the BPT token.
        (uint256 bptAmountOut, uint256 tokenIndexWithoutBpt) = userData.tokenInForExactBptOut();
        // Note that there is no maximum amountIn parameter: this is handled by `IVault.joinPool`.

        // Balances are passed through from the Vault hook, and include BPT
        _require(tokenIndexWithoutBpt < balancesWithoutBpt.length, Errors.OUT_OF_BOUNDS);

        // We join with a single token, so initialize amountsIn with zeros.
        uint256[] memory amountsIn = new uint256[](balancesWithoutBpt.length);

        // And then assign the result to the selected token.
        amountsIn[tokenIndexWithoutBpt] = StableMath._calcTokenInGivenExactBptOut(
            currentAmp,
            balancesWithoutBpt,
            tokenIndexWithoutBpt,
            bptAmountOut,
            virtualSupply,
            preJoinExitInvariant,
            getSwapFeePercentage()
        );

        return (bptAmountOut, amountsIn);
    }

    // Exit Hooks

    /**
     * @dev Support single- and multi-token exits, but not explicit proportional exits, which are
     * supported through Recovery Mode.
     */
    function _doExit(
        uint256[] memory balancesWithoutBpt,
        uint256 currentAmp,
        uint256 preJoinExitSupply,
        uint256 preJoinExitInvariant,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal view returns (uint256, uint256[] memory) {
        StablePhantomPoolUserData.ExitKindPhantom kind = userData.exitKind();
        if (kind == StablePhantomPoolUserData.ExitKindPhantom.BPT_IN_FOR_EXACT_TOKENS_OUT) {
            return
                _exitBPTInForExactTokensOut(
                    preJoinExitSupply,
                    preJoinExitInvariant,
                    currentAmp,
                    balancesWithoutBpt,
                    scalingFactors,
                    userData
                );
        } else if (kind == StablePhantomPoolUserData.ExitKindPhantom.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
            return _exitExactBPTInForTokenOut(preJoinExitSupply, preJoinExitInvariant, currentAmp, balancesWithoutBpt, userData);
        } else {
            _revert(Errors.UNHANDLED_EXIT_KIND);
        }
    }

    /**
     * @dev Multi-token exit. Proportional exits will pay no protocol fees.
     */
    function _exitBPTInForExactTokensOut(
        uint256 virtualSupply,
        uint256 preJoinExitInvariant,
        uint256 currentAmp,
        uint256[] memory balancesWithoutBpt,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        (uint256[] memory amountsOut, uint256 maxBPTAmountIn) = userData.bptInForExactTokensOut();
        InputHelpers.ensureInputLengthMatch(amountsOut.length, balancesWithoutBpt.length);

        // The user-provided amountsIn is unscaled, so we address that.
        _upscaleArray(amountsOut, _dropBptItem(scalingFactors));

        uint256 bptAmountIn = StableMath._calcBptInGivenExactTokensOut(
            currentAmp,
            balancesWithoutBpt,
            amountsOut,
            virtualSupply,
            preJoinExitInvariant,
            getSwapFeePercentage()
        );
        _require(bptAmountIn <= maxBPTAmountIn, Errors.BPT_IN_MAX_AMOUNT);

        return (bptAmountIn, amountsOut);
    }

    /**
     * @dev Single-token exit, equivalent to swapping BPT for a pool token.
     */
    function _exitExactBPTInForTokenOut(
        uint256 virtualSupply,
        uint256 preJoinExitInvariant,
        uint256 currentAmp,
        uint256[] memory balancesWithoutBpt,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        // Since this index is sent in from the user, we interpret it as NOT including the BPT token
        (uint256 bptAmountIn, uint256 tokenIndexWithoutBpt) = userData.exactBptInForTokenOut();
        // Note that there is no minimum amountOut parameter: this is handled by `IVault.exitPool`.

        _require(tokenIndexWithoutBpt < balancesWithoutBpt.length, Errors.OUT_OF_BOUNDS);

        // We exit in a single token, so initialize amountsOut with zeros
        uint256[] memory amountsOut = new uint256[](balancesWithoutBpt.length);

        // And then assign the result to the selected token.
        amountsOut[tokenIndexWithoutBpt] = StableMath._calcTokenOutGivenExactBptIn(
            currentAmp,
            balancesWithoutBpt,
            tokenIndexWithoutBpt,
            bptAmountIn,
            virtualSupply,
            preJoinExitInvariant,
            getSwapFeePercentage()
        );

        return (bptAmountIn, amountsOut);
    }

    /**
     * @dev We cannot use the default RecoveryMode implementation here, since we need to account for the BPT token.
     */
    function _doRecoveryModeExit(
        uint256[] memory balances,
        uint256,
        bytes memory userData
    ) internal virtual override returns (uint256, uint256[] memory) {
        // Since this Pool uses preminted BPT, we need to replace the total supply with the virtual total supply, and
        // adjust the balances array by removing BPT from it.
        (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _dropBptItemFromBalances(balances);

        (uint256 bptAmountIn, uint256[] memory amountsOut) = super._doRecoveryModeExit(
            balancesWithoutBpt,
            virtualSupply,
            userData
        );

        // The vault requires an array including BPT, so add it back in here.
        return (bptAmountIn, _addBptItem(amountsOut, 0));
    }

    // Virtual Supply

    /**
     * @dev Returns the number of tokens in circulation.
     *
     * In other pools, this would be the same as `totalSupply`, but since this pool pre-mints BPT and holds it in the
     * Vault as a token, we need to subtract the Vault's balance to get the total "circulating supply". Both the
     * totalSupply and Vault balance can change. If users join or exit using swaps, some of the preminted BPT are
     * exchanged, so the Vault's balance increases after joins and decreases after exits. If users call the regular
     * joins/exit functions, the totalSupply can change as BPT are minted for joins or burned for exits.
     */
    function getVirtualSupply() external view returns (uint256) {
        // For a 3 token General Pool, it is cheaper to query the balance for a single token than to read all balances,
        // as getPoolTokenInfo will check for token existence, token balance and Asset Manager (3 reads), while
        // getPoolTokens will read the number of tokens, their addresses and balances (7 reads).
        // The more tokens the Pool has, the more expensive `getPoolTokens` becomes, while `getPoolTokenInfo`'s gas
        // remains constant.
        (uint256 cash, uint256 managed, , ) = getVault().getPoolTokenInfo(getPoolId(), IERC20(this));

        // Note that unlike all other balances, the Vault's BPT balance does not need scaling as its scaling factor is
        // ONE. This addition cannot overflow due to the Vault's balance limits.
        return _getVirtualSupply(cash + managed);
    }

    // The initial amount of BPT pre-minted is _PREMINTED_TOKEN_BALANCE, and it goes entirely to the pool balance in the
    // vault. So the virtualSupply (the actual supply in circulation) is defined as:
    // virtualSupply = totalSupply() - _balances[_bptIndex]
    function _getVirtualSupply(uint256 bptBalance) internal view returns (uint256) {
        return totalSupply().sub(bptBalance);
    }

    /**
     * @dev Same as `_dropBptItem` in StablePoolStorage, except the virtual supply is also returned, and `balances`
     * is assumed to be the current Pool balances.
     */
    function _dropBptItemFromBalances(uint256[] memory balances) internal view returns (uint256, uint256[] memory) {
        return (_getVirtualSupply(balances[getBptIndex()]), _dropBptItem(balances));
    }

    // BPT rate

    /**
     * @dev This function returns the appreciation of one BPT relative to the
     * underlying tokens. This starts at 1 when the pool is created and grows over time.
     * Because of preminted BPT, it uses `getVirtualSupply` instead of `totalSupply`.
     */
    function getRate() public view virtual override returns (uint256) {
        (, uint256[] memory balancesIncludingBpt, ) = getVault().getPoolTokens(getPoolId());
        _upscaleArray(balancesIncludingBpt, _scalingFactors());

        (uint256 virtualSupply, uint256[] memory balances) = _dropBptItemFromBalances(balancesIncludingBpt);

        (uint256 currentAmp, ) = _getAmplificationParameter();

        return StableMath._getRate(balances, currentAmp, virtualSupply);
    }

    // Protocol Fees

    /**
     * @dev Before joins or exits, calculate the invariant using the old rates for exempt tokens (i.e., the rates
     * at the time of the previous join or exit), in order to exclude the yield from the calculation for those tokens.
     * Calculate the (non-exempt) yield and swap fee growth separately, and apply the corresponding protocol fee
     * percentage to each type.
     */
    function _payProtocolFeesBeforeJoinExit(uint256[] memory balances) private returns (uint256, uint256[] memory) {
        // Apply the rate adjustment to exempt tokens: multiply by oldRate / currentRate to "undo" the current scaling,
        // and apply the old rate. These functions copy `balances` to local storage, so they are not mutated and can
        // be reused.

        // Do not ignore the exempt flags when calculating total growth = swap fees + non-exempt token yield.
        uint256[] memory totalGrowthBalances = _dropBptItem(_getAdjustedBalances(balances, false));
        // Ignore the exempt flags to use the oldRate for all tokens, corresponding to the growth from swap fees alone.
        uint256[] memory swapGrowthBalances = _dropBptItem(_getAdjustedBalances(balances, true));

        // Charge the protocol fee in BPT, using the growth in invariant between _postJoinExitInvariant
        // and adjusted versions of the current invariant. We have separate protocol fee percentages for growth based
        // on yield and growth based on swap fees, so we need to compute each type separately.

        // To convert each protocol fee to a BPT amount for each type of growth, we compute the relevant invariant
        // growth ratio, extract the portion due the protocol, and then compute the equivalent amount of BPT that
        // would cause such an increase.
        //
        // Invariant growth is related to new BPT and supply by: invariant ratio = (bpt amount + supply) / supply
        // With some manipulation, this becomes:                 (invariant ratio - 1) * supply = bpt amount
        //
        // However, a part of the invariant growth was due to non-protocol swap fees (i.e. value accrued by the
        // LPs), so we only mint a percentage of this BPT amount: that which corresponds to protocol fees.

        uint256 postJoinExitAmp = _postJoinExitAmp;

        uint256 totalGrowthInvariant = StableMath._calculateInvariant(postJoinExitAmp, totalGrowthBalances);
        uint256 swapGrowthInvariant = StableMath._calculateInvariant(postJoinExitAmp, swapGrowthBalances);

        // Total Growth = Invariant with old rates for exempt tokens / last invariant: swap fees + token yields
        // Swap Fee Growth = Invariant with old rates for all tokens / last invariant: swap fees alone
        // Growth due to yield = Total Growth / Swap Fee Growth
        //                     = Invariant with masked rates / Invariant with old rates.

        // If the "growth" is negative, set the ratio to ONE: multiplying by (ratio - 1) will then result in zero fees.
        uint256 yieldGrowthRatio = totalGrowthInvariant > swapGrowthInvariant
            ? totalGrowthInvariant.divDown(swapGrowthInvariant)
            : FixedPoint.ONE;

        uint256 postJoinExitInvariant = _postJoinExitInvariant;

        uint256 swapGrowthRatio = swapGrowthInvariant > postJoinExitInvariant
            ? swapGrowthInvariant.divDown(postJoinExitInvariant)
            : FixedPoint.ONE;

        (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _dropBptItemFromBalances(balances);

        // Apply separate protocol fee rates on yield and swap fee growth.
        // Total protocol fee rate = (FeeOnYield * (yieldGrowthRatio - 1) + FeeOnSwap * (swapGrowthRatio - 1))

        // We round down, favoring LP fees.
        uint256 protocolFeeAmount = getProtocolFeePercentageCache(ProtocolFeeType.YIELD)
            .mulDown(yieldGrowthRatio.sub(FixedPoint.ONE))
            .add(getProtocolFeePercentageCache(ProtocolFeeType.SWAP).mulDown(swapGrowthRatio.sub(FixedPoint.ONE)))
            .mulDown(virtualSupply);

        if (protocolFeeAmount > 0) {
            _payProtocolFees(protocolFeeAmount);
        }

        // We pay fees before a join or exit to ensure the pool is debt-free, so that swap fee and quote calculations
        // based on the virtual supply reflect only the current user's transaction. We have just increased the virtual
        // supply by minting the protocol fee tokens, so those are included in the return value.
        //
        // For this addition to overflow, the actual total supply would have already overflowed.
        return (virtualSupply + protocolFeeAmount, balancesWithoutBpt);
    }

    /**
     * @dev Store the latest invariant based on the adjusted balances after the join or exit, using current rates.
     * Also cache the amp factor, so that the invariant is not affected by amp updates between joins and exits.
     */
    function _updateInvariantAfterJoinExit(
        uint256 currentAmp,
        uint256[] memory balancesWithoutBpt,
        uint256 preJoinExitInvariant,
        uint256 preJoinExitSupply,
        uint256 postJoinExitSupply
    ) internal {
        uint256 postJoinExitInvariant = StableMath._calculateInvariant(currentAmp, balancesWithoutBpt);

        // Compute the growth ratio between the pre- and post-join/exit balances.
        // Note that the pre-join/exit invariant is *not* the invariant from the last join,
        // but computed from the balances before this particular join/exit.

        uint256 protocolSwapFeePercentage = getProtocolFeePercentageCache(ProtocolFeeType.SWAP);

        if (protocolSwapFeePercentage > 0) {
            uint256 invariantGrowthRatio = (
                postJoinExitInvariant > preJoinExitInvariant
                    ? postJoinExitInvariant.sub(preJoinExitInvariant)
                    : preJoinExitInvariant.sub(postJoinExitInvariant)
            )
                .divDown(preJoinExitInvariant);

            // Compute the bpt ratio
            uint256 bptGrowthRatio = (
                postJoinExitSupply > preJoinExitInvariant
                    ? postJoinExitSupply.sub(preJoinExitSupply)
                    : preJoinExitSupply.sub(postJoinExitSupply)
            )
                .divDown(preJoinExitSupply);

            // The difference between the invariant growth and bpt increase rates must be due to the
            // balance change from this join/exit.
            // Protocol fees due = (invariant growth / bpt increase - 1) * virtual supply * protocol fee %
            // For instance, if the invariant growth is 1.05, and the bpt increase is 1.0475, with 1000 supply,
            // and a protocol fee of 50%, we would mint (1.05/1.0475 - 1) * 1000 * 0.5 = 1.193 BPT.

            if (invariantGrowthRatio > bptGrowthRatio) {
                uint256 protocolFeeAmount = invariantGrowthRatio
                    .divDown(bptGrowthRatio)
                    .sub(FixedPoint.ONE)
                    .mulDown(preJoinExitSupply)
                    .mulDown(protocolSwapFeePercentage);

                _payProtocolFees(protocolFeeAmount);
            }
        }

        // Update the stored invariant and amp values.
        _postJoinExitAmp = currentAmp;
        _postJoinExitInvariant = postJoinExitInvariant;

        // Copy the current rates to the old rates.
        _updateOldRates();
    }

    // Helpers

    /**
     * @dev Mutates `amounts` by applying `mutation` with each entry in `arguments`.
     *
     * Equivalent to `amounts = amounts.map(mutation)`.
     */
    function _mutateAmounts(
        uint256[] memory toMutate,
        uint256[] memory arguments,
        function(uint256, uint256) pure returns (uint256) mutation
    ) private pure {
        for (uint256 i = 0; i < toMutate.length; ++i) {
            toMutate[i] = mutation(toMutate[i], arguments[i]);
        }
    }

    // Permissioned functions

    /**
     * @dev Inheritance rules still require us to override this in the most derived contract, even though
     * it only calls super.
     */
    function _isOwnerOnlyAction(bytes32 actionId)
        internal
        view
        virtual
        override(
            // Our inheritance pattern creates a small diamond that requires explicitly listing the parents here.
            // Each parent calls the `super` version, so linearization ensures all implementations are called.
            BasePool,
            BasePoolAuthorization,
            StablePoolAmplification,
            StablePoolRates
        )
        returns (bool)
    {
        return super._isOwnerOnlyAction(actionId);
    }
}
