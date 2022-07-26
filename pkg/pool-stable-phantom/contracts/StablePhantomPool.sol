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
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "@balancer-labs/v2-pool-utils/contracts/BaseGeneralPool.sol";
import "@balancer-labs/v2-pool-utils/contracts/rates/PriceRateCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/ProtocolFeeCache.sol";

import "./StablePoolStorage.sol";

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
contract StablePhantomPool is IRateProvider, BaseGeneralPool, StablePoolStorage, ProtocolFeeCache {
    using WordCodec for bytes32;
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

    // Amplification factor changes must happen over a minimum period of one day, and can at most divide or multiply the
    // current value by 2 every day.
    // WARNING: this only limits *a single* amplification change to have a maximum rate of change of twice the original
    // value daily. It is possible to perform multiple amplification changes in sequence to increase this value more
    // rapidly: for example, by doubling the value every day it can increase by a factor of 8 over three days (2^3).
    uint256 private constant _MIN_UPDATE_TIME = 1 days;
    uint256 private constant _MAX_AMP_UPDATE_DAILY_RATE = 2;

    // The amplification data structure is as follows:
    // [  64 bits |   64 bits  |  64 bits  |   64 bits   ]
    // [ end time | start time | end value | start value ]
    // |MSB                                           LSB|

    uint256 private constant _AMP_START_VALUE_OFFSET = 0;
    uint256 private constant _AMP_END_VALUE_OFFSET = 64;
    uint256 private constant _AMP_START_TIME_OFFSET = 128;
    uint256 private constant _AMP_END_TIME_OFFSET = 192;

    uint256 private constant _AMP_VALUE_BIT_LENGTH = 64;
    uint256 private constant _AMP_TIMESTAMP_BIT_LENGTH = 64;

    bytes32 private _packedAmplificationData;

    event AmpUpdateStarted(uint256 startValue, uint256 endValue, uint256 startTime, uint256 endTime);
    event AmpUpdateStopped(uint256 currentValue);

    // Token rate caches are used to avoid querying the price rate for a token every time we need to work with it.
    // The "old rate" field is used for precise protocol fee calculation, to ensure that token yield is only
    // "taxed" once. The data structure is as follows:
    //
    // [ expires | duration | old rate | current rate ]
    // [ uint32  |  uint32  |  uint96  |   uint96     ]

    mapping(IERC20 => bytes32) private _tokenRateCaches;

    event TokenRateCacheUpdated(IERC20 indexed token, uint256 rate);
    event TokenRateProviderSet(IERC20 indexed token, IRateProvider indexed provider, uint256 cacheDuration);

    // The constructor arguments are received in a struct to work around stack-too-deep issues
    struct NewPoolParams {
        IVault vault;
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
        StablePoolStorage(
            _insertSorted(params.tokens, IERC20(this)),
            params.rateProviders,
            params.exemptFromYieldProtocolFeeFlags
        )
        ProtocolFeeCache(params.vault, ProtocolFeeCache.DELEGATE_PROTOCOL_FEES_SENTINEL)
    {
        InputHelpers.ensureInputLengthMatch(
            params.tokens.length,
            params.rateProviders.length,
            params.tokenRateCacheDurations.length
        );
        InputHelpers.ensureInputLengthMatch(params.tokens.length, params.exemptFromYieldProtocolFeeFlags.length);

        _require(params.amplificationParameter >= StableMath._MIN_AMP, Errors.MIN_AMP);
        _require(params.amplificationParameter <= StableMath._MAX_AMP, Errors.MAX_AMP);

        uint256 initialAmp = Math.mul(params.amplificationParameter, StableMath._AMP_PRECISION);
        _setAmplificationData(initialAmp);

        for (uint256 i = 0; i < params.tokens.length; i++) {
            if (params.rateProviders[i] != IRateProvider(0)) {
                _updateTokenRateCache(params.tokens[i], params.rateProviders[i], params.tokenRateCacheDurations[i]);
                emit TokenRateProviderSet(params.tokens[i], params.rateProviders[i], params.tokenRateCacheDurations[i]);
            }
        }
    }

    function getMinimumBpt() external pure returns (uint256) {
        return _getMinimumBpt();
    }

    // Swap Hooks

    /**
     * @notice Top-level Vault hook for swaps.
     * @dev Overriden here to ensure the token rate cache is updated *before* calling `_scalingFactors`, which happens
     * in the base contract during upscaling of balances. Otherwise, the first transaction after the cache period
     * expired would still use the old rates.
     */
    function onSwap(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public virtual override returns (uint256) {
        _cacheTokenRatesIfNecessary();

        return super.onSwap(swapRequest, balances, indexIn, indexOut);
    }

    /**
     * @dev Override this hook called by the base class `onSwap`, to check whether we are doing a regular swap,
     * or a swap involving BPT, which is equivalent to a single token join or exit. Since one of the Pool's
     * tokens is the preminted BPT, we need to a) handle swaps where BPT is involved separately, and
     * b) remove BPT from the balances array when processing regular swaps, before calling the StableMath functions.
     *
     * At this point, the balances are unscaled.
     *
     * If this is a swap involving BPT, call `_onSwapBpt`, which computes the amountOut using the swapFeePercentage,
     * in the same manner as single token join/exits, and charges protocol fees on the corresponding bptAmount.
     * Otherwise, perform the default processing for a regular swap.
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
     * tokens is the preminted BPT, we need to a) handle swaps where BPT is involved separately, and
     * b) remove BPT from the balances array when processing regular swaps, before calling the StableMath functions.
     *
     * At this point, the balances are unscaled.
     *
     * If this is a swap involving BPT, call `_onSwapBpt`, which computes the amountIn using the swapFeePercentage,
     * in the same manner as single token join/exits, and charges protocol fees on the corresponding bptAmount.
     * Otherwise, perform the default processing for a regular swap.
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
     * @dev Since we have overridden `onSwap` here to filter swaps involving BPT, this BaseGeneralPool hook will only
     * be called for regular swaps.
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
     * @dev Since we have overridden `onSwap` here to filter swaps involving BPT, this BaseGeneralPool hook will only
     * be called for regular swaps.
     */
    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override returns (uint256 amountIn) {
        return _onRegularSwap(IVault.SwapKind.GIVEN_OUT, request.amount, balancesIncludingBpt, indexIn, indexOut);
    }

    function _onRegularSwap(
        IVault.SwapKind kind,
        uint256 givenAmount,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) private returns (uint256 calculatedAmount) {
        // Compute virtual BPT supply and token balances (sans BPT).
        (uint256 virtualSupply, uint256[] memory balances) = _dropBptItemFromBalances(balancesIncludingBpt);
        uint256 protocolSwapFeePercentage = getProtocolSwapFeePercentageCache();

        (uint256 currentAmp, ) = _getAmplificationParameter();
        uint256 invariant = StableMath._calculateInvariant(currentAmp, balances);

        // Adjust indices for BPT token
        indexIn = _skipBptIndex(indexIn);
        indexOut = _skipBptIndex(indexOut);

        // Would like to use a function pointer here, but it causes stack issues
        if (kind == IVault.SwapKind.GIVEN_IN) {
            calculatedAmount = StableMath._calcOutGivenIn(
                currentAmp,
                balances,
                indexIn,
                indexOut,
                givenAmount,
                invariant
            );
        } else {
            calculatedAmount = StableMath._calcInGivenOut(
                currentAmp,
                balances,
                indexIn,
                indexOut,
                givenAmount,
                invariant
            );
        }

        if (protocolSwapFeePercentage > 0) {
            uint256 amountInWithFee = _addSwapFeeAmount(
                kind == IVault.SwapKind.GIVEN_IN ? givenAmount : calculatedAmount
            );
            uint256 amountOut = kind == IVault.SwapKind.GIVEN_IN ? calculatedAmount : givenAmount;

            balances[indexIn] = balances[indexIn].add(amountInWithFee);
            balances[indexOut] = balances[indexOut].sub(amountOut);

            _payDueProtocolFeeByInvariantIncrement(
                invariant,
                currentAmp,
                balances,
                virtualSupply,
                protocolSwapFeePercentage
            );
        }
    }

    function _swapWithBpt(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut,
        uint256[] memory scalingFactors
    ) private returns (uint256) {
        _upscaleArray(balances, scalingFactors);

        (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _dropBptItemFromBalances(balances);
        uint256 protocolSwapFeePercentage = getProtocolSwapFeePercentageCache();
        (uint256 amp, ) = _getAmplificationParameter();

        bool bptIsTokenIn = swapRequest.tokenIn == IERC20(this);

        // The lower level function return values are still upscaled, so we need to downscale the final return value
        if (swapRequest.kind == IVault.SwapKind.GIVEN_IN) {
            // Returning amountOut; tokens are leaving the Vault, so we round down
            return
                _downscaleDown(
                    _onSwapBptGivenIn(
                        _upscale(swapRequest.amount, scalingFactors[indexIn]),
                        indexIn,
                        indexOut,
                        bptIsTokenIn,
                        amp,
                        protocolSwapFeePercentage,
                        virtualSupply,
                        balancesWithoutBpt
                    ),
                    scalingFactors[indexOut]
                );
        } else {
            // Returning amountIn; tokens are entering the Vault, so we round up
            return
                _downscaleUp(
                    _onSwapBptGivenOut(
                        _upscale(swapRequest.amount, scalingFactors[indexOut]),
                        indexIn,
                        indexOut,
                        bptIsTokenIn,
                        amp,
                        protocolSwapFeePercentage,
                        virtualSupply,
                        balancesWithoutBpt
                    ),
                    scalingFactors[indexIn]
                );
        }
    }

    /**
     * @dev Process a GivenIn swap involving BPT. At this point, amount has been upscaled, and the BPT token
     * has been removed from balances. `indexIn` and `indexOut` include BPT.
     */
    function _onSwapBptGivenIn(
        uint256 amount,
        uint256 indexIn,
        uint256 indexOut,
        bool bptIsTokenIn,
        uint256 amp,
        uint256 protocolSwapFeePercentage,
        uint256 virtualSupply,
        uint256[] memory balancesWithoutBpt
    ) private returns (uint256 amountOut) {
        uint256 swapFeePercentage = getSwapFeePercentage();

        if (bptIsTokenIn) {
            // exitSwap
            amountOut = StableMath._calcTokenOutGivenExactBptIn(
                amp,
                balancesWithoutBpt,
                _skipBptIndex(indexOut),
                amount,
                virtualSupply,
                swapFeePercentage
            );
        } else {
            // joinSwap
            uint256[] memory amountsIn = new uint256[](balancesWithoutBpt.length);
            amountsIn[_skipBptIndex(indexIn)] = amount;

            amountOut = StableMath._calcBptOutGivenExactTokensIn(
                amp,
                balancesWithoutBpt,
                amountsIn,
                virtualSupply,
                swapFeePercentage
            );
        }

        if (protocolSwapFeePercentage > 0) {
            _payDueProtocolFeeByBpt(bptIsTokenIn ? amount : amountOut, protocolSwapFeePercentage);
        }
    }

    /**
     * @dev Process a GivenOut swap involving BPT. At this point, amount has been upscaled, and the BPT token
     * has been removed from balances. `indexIn` and `indexOut` include BPT.
     */
    function _onSwapBptGivenOut(
        uint256 amount,
        uint256 indexIn,
        uint256 indexOut,
        bool bptIsTokenIn,
        uint256 amp,
        uint256 protocolSwapFeePercentage,
        uint256 virtualSupply,
        uint256[] memory balancesWithoutBpt
    ) private returns (uint256 amountIn) {
        uint256 swapFeePercentage = getSwapFeePercentage();

        if (bptIsTokenIn) {
            // joinSwap
            uint256[] memory amountsOut = new uint256[](balancesWithoutBpt.length);
            amountsOut[_skipBptIndex(indexOut)] = amount;

            amountIn = StableMath._calcBptInGivenExactTokensOut(
                amp,
                balancesWithoutBpt,
                amountsOut,
                virtualSupply,
                swapFeePercentage
            );
        } else {
            // exitSwap
            amountIn = StableMath._calcTokenInGivenExactBptOut(
                amp,
                balancesWithoutBpt,
                _skipBptIndex(indexIn),
                amount,
                virtualSupply,
                swapFeePercentage
            );
        }

        if (protocolSwapFeePercentage > 0) {
            _payDueProtocolFeeByBpt(bptIsTokenIn ? amountIn : amount, protocolSwapFeePercentage);
        }
    }

    // Join Hooks

    /**
     * @notice Top-level Vault hook for joins.
     * @dev Overriden here to ensure the token rate cache is updated *before* calling `_scalingFactors`, which happens
     * in the base contract during upscaling of balances. Otherwise, the first transaction after the cache period
     * expired would still use the old rates.
     */
    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override(IBasePool, BasePool) returns (uint256[] memory, uint256[] memory) {
        _cacheTokenRatesIfNecessary();

        return
            super.onJoinPool(poolId, sender, recipient, balances, lastChangeBlock, protocolSwapFeePercentage, userData);
    }

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

        return (bptAmountOut, amountsInIncludingBpt);
    }

    /**
     * @dev Supports multi-token joins.
     */
    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory balances,
        uint256,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        StablePhantomPoolUserData.JoinKindPhantom kind = userData.joinKind();

        if (kind == StablePhantomPoolUserData.JoinKindPhantom.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return _joinExactTokensInForBPTOut(balances, scalingFactors, protocolSwapFeePercentage, userData);
        } else if (kind == StablePhantomPoolUserData.JoinKindPhantom.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return _joinTokenInForExactBPTOut(balances, protocolSwapFeePercentage, userData);
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    function _joinExactTokensInForBPTOut(
        uint256[] memory balances,
        uint256[] memory scalingFactors,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) private returns (uint256, uint256[] memory) {
        (uint256[] memory amountsIn, uint256 minBPTAmountOut) = userData.exactTokensInForBptOut();
        // Balances are passed through from the Vault hook, and include BPT
        InputHelpers.ensureInputLengthMatch(balances.length - 1, amountsIn.length);

        // The user-provided amountsIn is unscaled and does not include BPT, so we address that.
        (uint256[] memory scaledAmountsInWithBpt, uint256[] memory scaledAmountsInWithoutBpt) = _upscaleWithoutBpt(
            amountsIn,
            scalingFactors
        );

        uint256 bptAmountOut;
        // New scope to avoid stack-too-deep issues
        {
            (uint256 currentAmp, ) = _getAmplificationParameter();
            (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _dropBptItemFromBalances(balances);

            bptAmountOut = StableMath._calcBptOutGivenExactTokensIn(
                currentAmp,
                balancesWithoutBpt,
                scaledAmountsInWithoutBpt,
                virtualSupply,
                getSwapFeePercentage()
            );
        }

        _require(bptAmountOut >= minBPTAmountOut, Errors.BPT_OUT_MIN_AMOUNT);

        if (protocolSwapFeePercentage > 0) {
            _payDueProtocolFeeByBpt(bptAmountOut, protocolSwapFeePercentage);
        }

        return (bptAmountOut, scaledAmountsInWithBpt);
    }

    function _joinTokenInForExactBPTOut(
        uint256[] memory balances,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) private returns (uint256, uint256[] memory) {
        // Since this index is sent in from the user, we interpret it as NOT including the BPT token.
        (uint256 bptAmountOut, uint256 tokenIndexWithoutBpt) = userData.tokenInForExactBptOut();
        // Note that there is no maximum amountIn parameter: this is handled by `IVault.joinPool`.

        // Balances are passed through from the Vault hook, and include BPT
        _require(tokenIndexWithoutBpt < balances.length - 1, Errors.OUT_OF_BOUNDS);

        (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _dropBptItemFromBalances(balances);
        (uint256 currentAmp, ) = _getAmplificationParameter();

        // We join with a single token, so initialize amountsIn with zeros.
        uint256[] memory amountsIn = new uint256[](balances.length);

        // And then assign the result to the selected token.
        // The token index passed to the StableMath function must match the balances array (without BPT),
        // But the amountsIn array passed back to the Vault must include BPT.
        amountsIn[_addBptIndex(tokenIndexWithoutBpt)] = StableMath._calcTokenInGivenExactBptOut(
            currentAmp,
            balancesWithoutBpt,
            tokenIndexWithoutBpt,
            bptAmountOut,
            virtualSupply,
            getSwapFeePercentage()
        );

        if (protocolSwapFeePercentage > 0) {
            _payDueProtocolFeeByBpt(bptAmountOut, protocolSwapFeePercentage);
        }

        return (bptAmountOut, amountsIn);
    }

    // Exit Hooks

    /**
     * @notice Top-level Vault hook for exits.
     * @dev Overriden here to ensure the token rate cache is updated *before* calling `_scalingFactors`, which happens
     * in the base contract during upscaling of balances. Otherwise, the first transaction after the cache period
     * expired would still use the old rates.
     */
    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override(IBasePool, BasePool) returns (uint256[] memory, uint256[] memory) {
        // If this is a recovery mode exit, do not update the token rate cache: external calls might fail
        if (!userData.isRecoveryModeExitKind()) {
            _cacheTokenRatesIfNecessary();
        }

        return
            super.onExitPool(poolId, sender, recipient, balances, lastChangeBlock, protocolSwapFeePercentage, userData);
    }

    /**
     * @dev Support multi-token exits. Note that recovery mode exits do not call`_onExitPool`.
     */
    function _onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory balances,
        uint256,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        StablePhantomPoolUserData.ExitKindPhantom kind = userData.exitKind();
        uint256 bptAmountIn;
        uint256[] memory amountsOut;

        if (kind == StablePhantomPoolUserData.ExitKindPhantom.BPT_IN_FOR_EXACT_TOKENS_OUT) {
            (bptAmountIn, amountsOut) = _exitBPTInForExactTokensOut(
                balances,
                scalingFactors,
                protocolSwapFeePercentage,
                userData
            );
        } else if (kind == StablePhantomPoolUserData.ExitKindPhantom.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
            (bptAmountIn, amountsOut) = _exitExactBPTInForTokenOut(balances, protocolSwapFeePercentage, userData);
        } else {
            _revert(Errors.UNHANDLED_EXIT_KIND);
        }

        return (bptAmountIn, amountsOut);
    }

    function _exitExactBPTInForTokenOut(
        uint256[] memory balances,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) private returns (uint256, uint256[] memory) {
        // Since this index is sent in from the user, we interpret it as NOT including the BPT token
        (uint256 bptAmountIn, uint256 tokenIndexWithoutBpt) = userData.exactBptInForTokenOut();
        // Note that there is no minimum amountOut parameter: this is handled by `IVault.exitPool`.

        // The balances array passed in includes BPT.
        _require(tokenIndexWithoutBpt < balances.length - 1, Errors.OUT_OF_BOUNDS);

        (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _dropBptItemFromBalances(balances);
        (uint256 currentAmp, ) = _getAmplificationParameter();

        // We exit in a single token, so initialize amountsOut with zeros
        uint256[] memory amountsOut = new uint256[](balances.length);

        // And then assign the result to the selected token.
        // The token index passed to the StableMath function must match the balances array (without BPT),
        // But the amountsOut array passed back to the Vault must include BPT.
        amountsOut[_addBptIndex(tokenIndexWithoutBpt)] = StableMath._calcTokenOutGivenExactBptIn(
            currentAmp,
            balancesWithoutBpt,
            tokenIndexWithoutBpt,
            bptAmountIn,
            virtualSupply,
            getSwapFeePercentage()
        );

        if (protocolSwapFeePercentage > 0) {
            _payDueProtocolFeeByBpt(bptAmountIn, protocolSwapFeePercentage);
        }

        return (bptAmountIn, amountsOut);
    }

    function _exitBPTInForExactTokensOut(
        uint256[] memory balances,
        uint256[] memory scalingFactors,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) private returns (uint256, uint256[] memory) {
        (uint256[] memory amountsOut, uint256 maxBPTAmountIn) = userData.bptInForExactTokensOut();
        // amountsOut are unscaled, and do not include BPT
        InputHelpers.ensureInputLengthMatch(amountsOut.length, balances.length - 1);

        // The user-provided amountsIn is unscaled and does not include BPT, so we address that.
        (uint256[] memory scaledAmountsOutWithBpt, uint256[] memory scaledAmountsOutWithoutBpt) = _upscaleWithoutBpt(
            amountsOut,
            scalingFactors
        );

        // The balances array passed in includes BPT.
        (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _dropBptItemFromBalances(balances);
        (uint256 currentAmp, ) = _getAmplificationParameter();
        uint256 bptAmountIn = StableMath._calcBptInGivenExactTokensOut(
            currentAmp,
            balancesWithoutBpt,
            scaledAmountsOutWithoutBpt,
            virtualSupply,
            getSwapFeePercentage()
        );
        _require(bptAmountIn <= maxBPTAmountIn, Errors.BPT_IN_MAX_AMOUNT);

        if (protocolSwapFeePercentage > 0) {
            _payDueProtocolFeeByBpt(bptAmountIn, protocolSwapFeePercentage);
        }

        return (bptAmountIn, scaledAmountsOutWithBpt);
    }

    // We cannot use the default implementation here, since we need to account for the BPT token
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
        // one.
        // This addition cannot overflow due to the Vault's balance limits.
        return _getVirtualSupply(cash + managed);
    }

    // The initial amount of BPT pre-minted is _PREMINTED_TOKEN_BALANCE, and it goes entirely to the pool balance in the
    // vault. So the virtualSupply (the actual supply in circulation) is defined as:
    // virtualSupply = totalSupply() - _balances[_bptIndex]
    function _getVirtualSupply(uint256 bptBalance) internal view returns (uint256) {
        return totalSupply().sub(bptBalance);
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
     * @dev Pay protocol fees charged after a swap where BPT was not involved (i.e. a regular swap).
     */
    function _payDueProtocolFeeByInvariantIncrement(
        uint256 previousInvariant,
        uint256 amp,
        uint256[] memory postSwapBalances,
        uint256 virtualSupply,
        uint256 protocolSwapFeePercentage
    ) private {
        // To convert the protocol swap fees to a BPT amount, we compute the invariant growth (which is due exclusively
        // to swap fees), extract the portion that corresponds to protocol swap fees, and then compute the equivalent
        // amount of BPT that would cause such an increase.
        //
        // Invariant growth is related to new BPT and supply by:
        // invariant ratio = (bpt amount + supply) / supply
        // With some manipulation, this becomes:
        // (invariant ratio - 1) * supply = bpt amount
        //
        // However, a part of the invariant growth was due to non protocol swap fees (i.e. value accrued by the
        // LPs), so we only mint a percentage of this BPT amount: that which corresponds to protocol fees.

        // We round down, favoring LP fees.

        uint256 postSwapInvariant = StableMath._calculateInvariant(amp, postSwapBalances);
        uint256 invariantRatio = postSwapInvariant.divDown(previousInvariant);

        if (invariantRatio > FixedPoint.ONE) {
            // This condition should always be met outside of rounding errors (for non-zero swap fees).

            uint256 protocolFeeAmount = protocolSwapFeePercentage.mulDown(
                invariantRatio.sub(FixedPoint.ONE).mulDown(virtualSupply)
            );

            _payProtocolFees(protocolFeeAmount);
        }
    }

    /**
     * @dev Pays protocol fees charged after a swap where `bptAmount` was either sent or received (i.e. a
     * single-token join or exit).
     */
    function _payDueProtocolFeeByBpt(uint256 bptAmount, uint256 protocolSwapFeePercentage) private {
        uint256 feeAmount = _addSwapFeeAmount(bptAmount).sub(bptAmount);

        uint256 protocolFeeAmount = feeAmount.mulDown(protocolSwapFeePercentage);

        _payProtocolFees(protocolFeeAmount);
    }

    // Token rates

    /**
     * @dev Returns the token rate for token. All token rates are fixed-point values with 18 decimals.
     * In case there is no rate provider for the provided token it returns FixedPoint.ONE.
     */
    function getTokenRate(IERC20 token) public view virtual returns (uint256) {
        // We optimize for the scenario where all tokens have rate providers, except the BPT (which never has a rate
        // provider). Therefore, we return early if token is BPT, and otherwise optimistically read the cache expecting
        // that it will not be empty (instead of e.g. fetching the provider to avoid a cache read, since we don't need
        // the provider at all).

        if (token == this) {
            return FixedPoint.ONE;
        }

        bytes32 tokenRateCache = _tokenRateCaches[token];
        return tokenRateCache == bytes32(0) ? FixedPoint.ONE : tokenRateCache.getCurrentRate();
    }

    /**
     * @dev Returns the cached value for token's rate. Reverts if the token doesn't belong to the pool or has no rate
     * provider.
     */
    function getTokenRateCache(IERC20 token)
        external
        view
        returns (
            uint256 rate,
            uint256 duration,
            uint256 expires
        )
    {
        _require(_getRateProvider(token) != IRateProvider(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);

        rate = _tokenRateCaches[token].getCurrentRate();
        (duration, expires) = _tokenRateCaches[token].getTimestamps();
    }

    /**
     * @dev Sets a new duration for a token rate cache. It reverts if there was no rate provider set initially.
     * Note this function also updates the current cached value.
     * @param duration Number of seconds until the current token rate is fetched again.
     */
    function setTokenRateCacheDuration(IERC20 token, uint256 duration) external authenticate {
        IRateProvider provider = _getRateProvider(token);
        _require(address(provider) != address(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
        _updateTokenRateCache(token, provider, duration);
        emit TokenRateProviderSet(token, provider, duration);
    }

    /**
     * @dev Forces a rate cache hit for a token.
     * It will revert if the requested token does not have an associated rate provider.
     */
    function updateTokenRateCache(IERC20 token) public virtual {
        IRateProvider provider = _getRateProvider(token);
        _require(address(provider) != address(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
        uint256 duration = _tokenRateCaches[token].getDuration();
        _updateTokenRateCache(token, provider, duration);
    }

    /**
     * @dev Internal function to update a token rate cache for a known provider and duration.
     * It trusts the given values, and does not perform any checks.
     */
    function _updateTokenRateCache(
        IERC20 token,
        IRateProvider provider,
        uint256 duration
    ) private {
        uint256 rate = provider.getRate();
        bytes32 cache = _tokenRateCaches[token];

        _tokenRateCaches[token] = cache.updateRateAndDuration(rate, duration);

        emit TokenRateCacheUpdated(token, rate);
    }

    /**
     * @dev Caches the rates of all tokens if necessary
     */
    function _cacheTokenRatesIfNecessary() internal {
        uint256 totalTokens = _getTotalTokens();
        // prettier-ignore
        {
            _cacheTokenRateIfNecessary(_getToken0());
            _cacheTokenRateIfNecessary(_getToken1());
            _cacheTokenRateIfNecessary(_getToken2());
            if (totalTokens > 3) { _cacheTokenRateIfNecessary(_getToken3()); } else { return; }
            if (totalTokens > 4) { _cacheTokenRateIfNecessary(_getToken4()); } else { return; }
            if (totalTokens > 5) { _cacheTokenRateIfNecessary(_getToken5()); } else { return; }
        }
    }

    /**
     * @dev Caches the rate for a token if necessary. It ignores the call if there is no provider set.
     */
    function _cacheTokenRateIfNecessary(IERC20 token) internal virtual {
        // We optimize for the scenario where all tokens have rate providers, except the BPT (which never has a rate
        // provider). Therefore, we return early if token is BPT, and otherwise optimistically read the cache expecting
        // that it will not be empty (instead of e.g. fetching the provider to avoid a cache read in situations where
        // we might not need the provider if the cache is still valid).

        if (token == this) return;

        bytes32 cache = _tokenRateCaches[token];
        if (cache != bytes32(0)) {
            (uint256 duration, uint256 expires) = _tokenRateCaches[token].getTimestamps();
            if (block.timestamp > expires) {
                // solhint-disable-previous-line not-rely-on-time
                _updateTokenRateCache(token, _getRateProvider(token), duration);
            }
        }
    }

    // Scaling Factors

    function getScalingFactor(IERC20 token) external view returns (uint256) {
        return _scalingFactor(token);
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        return _tokenScalingFactor(token).mulDown(getTokenRate(token));
    }

    /**
     * @dev Overrides scaling factor getter to introduce the tokens' rates.
     */
    function _scalingFactors() internal view virtual override returns (uint256[] memory scalingFactors) {
        // There is no need to check the arrays length since both are based on `_getTotalTokens`
        uint256 totalTokens = _getTotalTokens();
        scalingFactors = new uint256[](totalTokens);

        // The Pool will always have at least 3 tokens so we always load these three scaling factors.
        // Given there is no generic direction for this rounding, it follows the same strategy as the BasePool.
        scalingFactors[0] = _getScalingFactor0().mulDown(getTokenRate(_getToken0()));
        scalingFactors[1] = _getScalingFactor1().mulDown(getTokenRate(_getToken1()));
        scalingFactors[2] = _getScalingFactor2().mulDown(getTokenRate(_getToken2()));

        // Before we load the remaining scaling factors we must check that the Pool contains enough tokens.
        if (totalTokens == 3) return scalingFactors;
        scalingFactors[3] = _getScalingFactor3().mulDown(getTokenRate(_getToken3()));

        if (totalTokens == 4) return scalingFactors;
        scalingFactors[4] = _getScalingFactor4().mulDown(getTokenRate(_getToken4()));

        if (totalTokens == 5) return scalingFactors;
        scalingFactors[5] = _getScalingFactor5().mulDown(getTokenRate(_getToken5()));
    }

    // Amplification

    function getAmplificationParameter()
        external
        view
        returns (
            uint256 value,
            bool isUpdating,
            uint256 precision
        )
    {
        (value, isUpdating) = _getAmplificationParameter();
        precision = StableMath._AMP_PRECISION;
    }

    function _getAmplificationParameter() internal view returns (uint256 value, bool isUpdating) {
        (uint256 startValue, uint256 endValue, uint256 startTime, uint256 endTime) = _getAmplificationData();

        // Note that block.timestamp >= startTime, since startTime is set to the current time when an update starts

        if (block.timestamp < endTime) {
            isUpdating = true;

            // We can skip checked arithmetic as:
            //  - block.timestamp is always larger or equal to startTime
            //  - endTime is always larger than startTime
            //  - the value delta is bounded by the largest amplification parameter, which never causes the
            //    multiplication to overflow.
            // This also means that the following computation will never revert nor yield invalid results.
            if (endValue > startValue) {
                value = startValue + ((endValue - startValue) * (block.timestamp - startTime)) / (endTime - startTime);
            } else {
                value = startValue - ((startValue - endValue) * (block.timestamp - startTime)) / (endTime - startTime);
            }
        } else {
            isUpdating = false;
            value = endValue;
        }
    }

    function _getAmplificationData()
        private
        view
        returns (
            uint256 startValue,
            uint256 endValue,
            uint256 startTime,
            uint256 endTime
        )
    {
        startValue = _packedAmplificationData.decodeUint(_AMP_START_VALUE_OFFSET, _AMP_VALUE_BIT_LENGTH);
        endValue = _packedAmplificationData.decodeUint(_AMP_END_VALUE_OFFSET, _AMP_VALUE_BIT_LENGTH);
        startTime = _packedAmplificationData.decodeUint(_AMP_START_TIME_OFFSET, _AMP_TIMESTAMP_BIT_LENGTH);
        endTime = _packedAmplificationData.decodeUint(_AMP_END_TIME_OFFSET, _AMP_TIMESTAMP_BIT_LENGTH);
    }

    /**
     * @dev Begins changing the amplification parameter to `rawEndValue` over time. The value will change linearly until
     * `endTime` is reached, when it will be `rawEndValue`.
     *
     * NOTE: Internally, the amplification parameter is represented using higher precision. The values returned by
     * `getAmplificationParameter` have to be corrected to account for this when comparing to `rawEndValue`.
     */
    function startAmplificationParameterUpdate(uint256 rawEndValue, uint256 endTime) external authenticate {
        _require(rawEndValue >= StableMath._MIN_AMP, Errors.MIN_AMP);
        _require(rawEndValue <= StableMath._MAX_AMP, Errors.MAX_AMP);

        uint256 duration = Math.sub(endTime, block.timestamp);
        _require(duration >= _MIN_UPDATE_TIME, Errors.AMP_END_TIME_TOO_CLOSE);

        (uint256 currentValue, bool isUpdating) = _getAmplificationParameter();
        _require(!isUpdating, Errors.AMP_ONGOING_UPDATE);

        uint256 endValue = Math.mul(rawEndValue, StableMath._AMP_PRECISION);

        // daily rate = (endValue / currentValue) / duration * 1 day
        // We perform all multiplications first to not reduce precision, and round the division up as we want to avoid
        // large rates. Note that these are regular integer multiplications and divisions, not fixed point.
        uint256 dailyRate = endValue > currentValue
            ? Math.divUp(Math.mul(1 days, endValue), Math.mul(currentValue, duration))
            : Math.divUp(Math.mul(1 days, currentValue), Math.mul(endValue, duration));
        _require(dailyRate <= _MAX_AMP_UPDATE_DAILY_RATE, Errors.AMP_RATE_TOO_HIGH);

        _setAmplificationData(currentValue, endValue, block.timestamp, endTime);
    }

    /**
     * @dev Stops the amplification parameter change process, keeping the current value.
     */
    function stopAmplificationParameterUpdate() external authenticate {
        (uint256 currentValue, bool isUpdating) = _getAmplificationParameter();
        _require(isUpdating, Errors.AMP_NO_ONGOING_UPDATE);

        _setAmplificationData(currentValue);
    }

    function _setAmplificationData(uint256 value) private {
        _storeAmplificationData(value, value, block.timestamp, block.timestamp);
        emit AmpUpdateStopped(value);
    }

    function _setAmplificationData(
        uint256 startValue,
        uint256 endValue,
        uint256 startTime,
        uint256 endTime
    ) private {
        _storeAmplificationData(startValue, endValue, startTime, endTime);
        emit AmpUpdateStarted(startValue, endValue, startTime, endTime);
    }

    function _storeAmplificationData(
        uint256 startValue,
        uint256 endValue,
        uint256 startTime,
        uint256 endTime
    ) private {
        _packedAmplificationData =
            WordCodec.encodeUint(startValue, _AMP_START_VALUE_OFFSET, _AMP_VALUE_BIT_LENGTH) |
            WordCodec.encodeUint(endValue, _AMP_END_VALUE_OFFSET, _AMP_VALUE_BIT_LENGTH) |
            WordCodec.encodeUint(startTime, _AMP_START_TIME_OFFSET, _AMP_TIMESTAMP_BIT_LENGTH) |
            WordCodec.encodeUint(endTime, _AMP_END_TIME_OFFSET, _AMP_TIMESTAMP_BIT_LENGTH);
    }

    // Permissioned functions

    /**
     * @dev Overrides only owner action to allow setting the cache duration for the token rates
     */
    function _isOwnerOnlyAction(bytes32 actionId)
        internal
        view
        virtual
        override(
            // The ProtocolFeeCache module creates a small diamond that requires explicitly listing the parents here
            BasePool,
            BasePoolAuthorization
        )
        returns (bool)
    {
        return
            (actionId == getActionId(this.setTokenRateCacheDuration.selector)) ||
            (actionId == getActionId(this.startAmplificationParameterUpdate.selector)) ||
            (actionId == getActionId(this.stopAmplificationParameterUpdate.selector)) ||
            super._isOwnerOnlyAction(actionId);
    }

    // Helpers

    /**
     * @dev Same as `_dropBptItem`, except the virtual supply is also returned, and `balances` is assumed to be the
     * current Pool balances.
     */
    function _dropBptItemFromBalances(uint256[] memory balances) internal view returns (uint256, uint256[] memory) {
        return (_getVirtualSupply(balances[getBptIndex()]), _dropBptItem(balances));
    }
}
