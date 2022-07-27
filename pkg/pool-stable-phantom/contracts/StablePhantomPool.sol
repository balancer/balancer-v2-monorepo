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
contract StablePhantomPool is IRateProvider, BaseGeneralPool, ProtocolFeeCache {
    using WordCodec for bytes32;
    using FixedPoint for uint256;
    using PriceRateCache for bytes32;
    using StablePhantomPoolUserData for bytes;
    using BasePoolUserData for bytes;

    // The Pool will register n+1 tokens, where n are the actual tokens in the Pool, and the other one is the BPT
    // itself.
    uint256 private immutable _totalTokens;

    // This minimum refers not to the total tokens, but rather to the non-BPT tokens. The minimum value for _totalTokens
    // is therefore _MIN_TOKENS + 1.
    uint256 private constant _MIN_TOKENS = 2;
    // The maximum imposed by the Vault, which stores balances in a packed format, is 2**(112) - 1.
    // We are preminting half of that value (rounded up).
    uint256 private constant _PREMINTED_TOKEN_BALANCE = 2**(111);

    // The index of BPT in the tokens and balances arrays, i.e. its index when calling IVault.registerTokens().
    uint256 private immutable _bptIndex;

    // These are the registered tokens: one of them will be the BPT.
    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    IERC20 internal immutable _token2;
    IERC20 internal immutable _token3;
    IERC20 internal immutable _token4;
    IERC20 internal immutable _token5;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.

    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;
    uint256 internal immutable _scalingFactor2;
    uint256 internal immutable _scalingFactor3;
    uint256 internal immutable _scalingFactor4;
    uint256 internal immutable _scalingFactor5;

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

    IRateProvider internal immutable _rateProvider0;
    IRateProvider internal immutable _rateProvider1;
    IRateProvider internal immutable _rateProvider2;
    IRateProvider internal immutable _rateProvider3;
    IRateProvider internal immutable _rateProvider4;
    IRateProvider internal immutable _rateProvider5;

    event TokenRateCacheUpdated(IERC20 indexed token, uint256 rate);
    event TokenRateProviderSet(IERC20 indexed token, IRateProvider indexed provider, uint256 cacheDuration);

    // Set true if the corresponding token should have its yield exempted from protocol fees.
    // For example, the BPT of another PhantomStable Pool containing yield tokens.
    // The flag will always be false for the BPT token.
    bool internal immutable _exemptFromYieldProtocolFeeToken0;
    bool internal immutable _exemptFromYieldProtocolFeeToken1;
    bool internal immutable _exemptFromYieldProtocolFeeToken2;
    bool internal immutable _exemptFromYieldProtocolFeeToken3;
    bool internal immutable _exemptFromYieldProtocolFeeToken4;
    bool internal immutable _exemptFromYieldProtocolFeeToken5;

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
        ProtocolFeeCache(params.vault, ProtocolFeeCache.DELEGATE_PROTOCOL_FEES_SENTINEL)
    {
        // BasePool checks that the Pool has at least two tokens, but since one of them is the BPT (this contract), we
        // need to check ourselves that there are at least creator-supplied tokens (i.e. the minimum number of total
        // tokens for this contract is actually three, including the BPT).
        _require(params.tokens.length >= _MIN_TOKENS, Errors.MIN_TOKENS);

        InputHelpers.ensureInputLengthMatch(
            params.tokens.length,
            params.rateProviders.length,
            params.tokenRateCacheDurations.length
        );
        InputHelpers.ensureInputLengthMatch(params.tokens.length, params.exemptFromYieldProtocolFeeFlags.length);

        _require(params.amplificationParameter >= StableMath._MIN_AMP, Errors.MIN_AMP);
        _require(params.amplificationParameter <= StableMath._MAX_AMP, Errors.MAX_AMP);

        IERC20[] memory registeredTokens = _insertSorted(params.tokens, IERC20(this));
        uint256 totalTokens = registeredTokens.length;
        _totalTokens = totalTokens;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _token0 = registeredTokens[0];
        _token1 = registeredTokens[1];
        _token2 = registeredTokens[2];
        _token3 = totalTokens > 3 ? registeredTokens[3] : IERC20(0);
        _token4 = totalTokens > 4 ? registeredTokens[4] : IERC20(0);
        _token5 = totalTokens > 5 ? registeredTokens[5] : IERC20(0);

        _scalingFactor0 = _computeScalingFactor(registeredTokens[0]);
        _scalingFactor1 = _computeScalingFactor(registeredTokens[1]);
        _scalingFactor2 = _computeScalingFactor(registeredTokens[2]);
        _scalingFactor3 = totalTokens > 3 ? _computeScalingFactor(registeredTokens[3]) : 0;
        _scalingFactor4 = totalTokens > 4 ? _computeScalingFactor(registeredTokens[4]) : 0;
        _scalingFactor5 = totalTokens > 5 ? _computeScalingFactor(registeredTokens[5]) : 0;

        uint256 initialAmp = Math.mul(params.amplificationParameter, StableMath._AMP_PRECISION);
        _setAmplificationData(initialAmp);

        for (uint256 i = 0; i < params.tokens.length; i++) {
            if (params.rateProviders[i] != IRateProvider(0)) {
                _updateTokenRateCache(params.tokens[i], params.rateProviders[i], params.tokenRateCacheDurations[i]);
                emit TokenRateProviderSet(params.tokens[i], params.rateProviders[i], params.tokenRateCacheDurations[i]);

                if (params.exemptFromYieldProtocolFeeFlags[i]) {
                    // Initialize the old rates as well, in case they are referenced before the first join.
                    _updateOldRate(params.tokens[i]);
                }
            }
        }

        // The Vault keeps track of all Pool tokens in a specific order: we need to know what the index of BPT is in
        // this ordering to be able to identify it when balances arrays are received. Since the tokens array is sorted,
        // we need to find the correct BPT index in the array returned by `_insertSorted()`.
        // See `IVault.getPoolTokens()` for more information regarding token ordering.
        uint256 bptIndex;
        for (bptIndex = params.tokens.length; bptIndex > 0 && params.tokens[bptIndex - 1] > IERC20(this); bptIndex--) {
            // solhint-disable-previous-line no-empty-blocks
        }
        _bptIndex = bptIndex;

        // The rate providers are stored as immutable state variables, and for simplicity when accessing those we'll
        // reference them by token index in the full base tokens plus BPT set (i.e. the tokens the Pool registers). Due
        // to immutable variables requiring an explicit assignment instead of defaulting to an empty value, it is
        // simpler to create a new memory array with the values we want to assign to the immutable state variables.
        IRateProvider[] memory rateProviders = new IRateProvider[](params.tokens.length + 1);
        // Do the same with exemptFromYieldProtocolFeeFlags
        bool[] memory exemptFromYieldFlags = new bool[](rateProviders.length);

        for (uint256 i = 0; i < rateProviders.length; ++i) {
            if (i < bptIndex) {
                rateProviders[i] = params.rateProviders[i];
                exemptFromYieldFlags[i] = params.exemptFromYieldProtocolFeeFlags[i];
            } else if (i == bptIndex) {
                rateProviders[i] = IRateProvider(0);
                exemptFromYieldFlags[i] = false;
            } else {
                rateProviders[i] = params.rateProviders[i - 1];
                exemptFromYieldFlags[i] = params.exemptFromYieldProtocolFeeFlags[i - 1];
            }

            // The exemptFromYieldFlag should never be set on a token without a rate provider.
            // This would cause division by zero errors downstream.
            _require(
                !(exemptFromYieldFlags[i] && rateProviders[i] == IRateProvider(0)),
                Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER
            );
        }

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _rateProvider0 = rateProviders[0];
        _rateProvider1 = rateProviders[1];
        _rateProvider2 = rateProviders[2];
        _rateProvider3 = (rateProviders.length > 3) ? rateProviders[3] : IRateProvider(0);
        _rateProvider4 = (rateProviders.length > 4) ? rateProviders[4] : IRateProvider(0);
        _rateProvider5 = (rateProviders.length > 5) ? rateProviders[5] : IRateProvider(0);

        _exemptFromYieldProtocolFeeToken0 = exemptFromYieldFlags[0];
        _exemptFromYieldProtocolFeeToken1 = exemptFromYieldFlags[1];
        _exemptFromYieldProtocolFeeToken2 = exemptFromYieldFlags[2];
        _exemptFromYieldProtocolFeeToken3 = (rateProviders.length > 3) ? exemptFromYieldFlags[3] : false;
        _exemptFromYieldProtocolFeeToken4 = (rateProviders.length > 4) ? exemptFromYieldFlags[4] : false;
        _exemptFromYieldProtocolFeeToken5 = (rateProviders.length > 5) ? exemptFromYieldFlags[5] : false;
    }

    function getMinimumBpt() external pure returns (uint256) {
        return _getMinimumBpt();
    }

    function getBptIndex() external view returns (uint256) {
        return _bptIndex;
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        // The BPT will be one of the Pool tokens, but it is unaffected by the Stable 5 token limit.
        return StableMath._MAX_STABLE_TOKENS + 1;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _totalTokens;
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
    ) private view returns (uint256 calculatedAmount) {
        uint256[] memory balances = _dropBptItem(balancesIncludingBpt);
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
    }

    function _swapWithBpt(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut,
        uint256[] memory scalingFactors
    ) private returns (uint256 result) {
        _upscaleArray(balances, scalingFactors);

        (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _payProtocolFeesBeforeJoinExit(balances);

        bool isJoinSwap = swapRequest.tokenOut == IERC20(this);
        bool isGivenIn = swapRequest.kind == IVault.SwapKind.GIVEN_IN;

        uint256 amountGiven = _upscale(swapRequest.amount, scalingFactors[isGivenIn ? indexIn : indexOut]);
        (uint256 amp, ) = _getAmplificationParameter();

        // The lower level function return values are still upscaled, so we need to downscale the final return value
        if (isJoinSwap) {
            uint256 indexInNoBpt = _skipBptIndex(indexIn);
            uint256 amountCalculated = _onSwapBptJoin(
                amountGiven,
                indexInNoBpt,
                isGivenIn,
                amp,
                virtualSupply,
                balancesWithoutBpt
            );

            if (isGivenIn) {
                balancesWithoutBpt[indexInNoBpt] += amountGiven;
                // If join is "given in" then `amountCalculated` is an amountOut (BPT from the Vault), so we round down.
                // so we round down.
                result = _downscaleDown(amountCalculated, scalingFactors[indexOut]);
            } else {
                balancesWithoutBpt[indexInNoBpt] += amountCalculated;
                // If join is "given out" then `amountCalculated` is an amountIn (tokens to the Vault), so we round up.
                result = _downscaleUp(amountCalculated, scalingFactors[indexIn]);
            }
        } else {
            uint256 indexOutNoBpt = _skipBptIndex(indexOut);
            uint256 amountCalculated = _onSwapBptExit(
                amountGiven,
                indexOutNoBpt,
                isGivenIn,
                amp,
                virtualSupply,
                balancesWithoutBpt
            );

            if (isGivenIn) {
                balancesWithoutBpt[indexOutNoBpt] -= amountCalculated;
                // If exit is "given in" then `amountCalculated` is an amountOut (tokens from the Vault),
                // so we round down.
                result = _downscaleDown(amountCalculated, scalingFactors[indexOut]);
            } else {
                balancesWithoutBpt[indexOutNoBpt] -= amountGiven;
                // If exit is "given out" then `amountCalculated` is an amountIn (BPT burned), so we round up.
                result = _downscaleUp(amountCalculated, scalingFactors[indexIn]);
            }
        }

        _updateInvariantAfterJoinExit(amp, balancesWithoutBpt);
    }

    /**
     * @dev Process a swap from one of the Pool's tokens into BPT. At this point, amount has been upscaled, and the BPT
     * token has been removed from balances. `indexIn` is the input token's position within `balancesWithoutBpt`.
     */
    function _onSwapBptJoin(
        uint256 amount,
        uint256 indexIn,
        bool givenIn,
        uint256 amp,
        uint256 virtualSupply,
        uint256[] memory balancesWithoutBpt
    ) private view returns (uint256) {
        if (givenIn) {
            uint256[] memory amountsIn = new uint256[](balancesWithoutBpt.length);
            amountsIn[indexIn] = amount;

            return
                StableMath._calcBptOutGivenExactTokensIn(
                    amp,
                    balancesWithoutBpt,
                    amountsIn,
                    virtualSupply,
                    getSwapFeePercentage()
                );
        } else {
            return
                StableMath._calcTokenInGivenExactBptOut(
                    amp,
                    balancesWithoutBpt,
                    indexIn,
                    amount,
                    virtualSupply,
                    getSwapFeePercentage()
                );
        }
    }

    /**
     * @dev Process a swap from BPT into one of the Pool's tokens. At this point, amount has been upscaled, and the BPT
     * token has been removed from balances. `indexOut` is the output token's position within `balancesWithoutBpt`.
     */
    function _onSwapBptExit(
        uint256 amount,
        uint256 indexOut,
        bool givenIn,
        uint256 amp,
        uint256 virtualSupply,
        uint256[] memory balancesWithoutBpt
    ) private view returns (uint256) {
        if (givenIn) {
            return
                StableMath._calcTokenOutGivenExactBptIn(
                    amp,
                    balancesWithoutBpt,
                    indexOut,
                    amount,
                    virtualSupply,
                    getSwapFeePercentage()
                );
        } else {
            uint256[] memory amountsOut = new uint256[](balancesWithoutBpt.length);
            amountsOut[indexOut] = amount;
            return
                StableMath._calcBptInGivenExactTokensOut(
                    amp,
                    balancesWithoutBpt,
                    amountsOut,
                    virtualSupply,
                    getSwapFeePercentage()
                );
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
    ) public virtual override returns (uint256[] memory, uint256[] memory) {
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
        amountsInIncludingBpt[_bptIndex] = initialBpt;

        // Update invariant after join
        _postJoinExitInvariant = invariantAfterJoin;
        _postJoinExitAmp = amp;

        // Initialize the OldRates for exempt tokens
        _updateOldRates();

        return (bptAmountOut, amountsInIncludingBpt);
    }

    /**
     * @dev Supports single- and multi-token joins, except for explicit proportional joins.
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
        StablePhantomPoolUserData.JoinKindPhantom kind = userData.joinKind();

        (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _payProtocolFeesBeforeJoinExit(balances);

        if (kind == StablePhantomPoolUserData.JoinKindPhantom.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return _joinExactTokensInForBPTOut(virtualSupply, balancesWithoutBpt, scalingFactors, userData);
        } else if (kind == StablePhantomPoolUserData.JoinKindPhantom.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return _joinTokenInForExactBPTOut(virtualSupply, balancesWithoutBpt, userData);
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    function _joinExactTokensInForBPTOut(
        uint256 virtualSupply,
        uint256[] memory balancesWithoutBpt,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) private returns (uint256, uint256[] memory) {
        (uint256[] memory amountsIn, uint256 minBPTAmountOut) = userData.exactTokensInForBptOut();
        // Balances are passed through from the Vault hook, and include BPT
        InputHelpers.ensureInputLengthMatch(balancesWithoutBpt.length, amountsIn.length);

        // The user-provided amountsIn is unscaled and does not include BPT, so we address that.
        (uint256[] memory scaledAmountsInWithBpt, uint256[] memory scaledAmountsInWithoutBpt) = _upscaleWithoutBpt(
            amountsIn,
            scalingFactors
        );

        (uint256 currentAmp, ) = _getAmplificationParameter();
        uint256 bptAmountOut = StableMath._calcBptOutGivenExactTokensIn(
            currentAmp,
            balancesWithoutBpt,
            scaledAmountsInWithoutBpt,
            virtualSupply,
            getSwapFeePercentage()
        );

        _require(bptAmountOut >= minBPTAmountOut, Errors.BPT_OUT_MIN_AMOUNT);

        // Add amountsIn to get post-join balances
        _mutateAmounts(balancesWithoutBpt, scaledAmountsInWithoutBpt, FixedPoint.add);

        _updateInvariantAfterJoinExit(currentAmp, balancesWithoutBpt);

        return (bptAmountOut, scaledAmountsInWithBpt);
    }

    function _joinTokenInForExactBPTOut(
        uint256 virtualSupply,
        uint256[] memory balancesWithoutBpt,
        bytes memory userData
    ) private returns (uint256, uint256[] memory) {
        // Since this index is sent in from the user, we interpret it as NOT including the BPT token.
        (uint256 bptAmountOut, uint256 tokenIndexWithoutBpt) = userData.tokenInForExactBptOut();
        // Note that there is no maximum amountIn parameter: this is handled by `IVault.joinPool`.

        // Balances are passed through from the Vault hook, and include BPT
        _require(tokenIndexWithoutBpt < balancesWithoutBpt.length, Errors.OUT_OF_BOUNDS);

        // We join with a single token, so initialize amountsIn with zeros.
        uint256[] memory amountsIn = new uint256[](balancesWithoutBpt.length + 1);
        (uint256 currentAmp, ) = _getAmplificationParameter();

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

        // Add amountsIn to get post-join balances
        _mutateAmounts(balancesWithoutBpt, _dropBptItem(amountsIn), FixedPoint.add);

        _updateInvariantAfterJoinExit(currentAmp, balancesWithoutBpt);

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
    ) public virtual override returns (uint256[] memory, uint256[] memory) {
        // If this is a recovery mode exit, do not update the token rate cache: external calls might fail
        if (!userData.isRecoveryModeExitKind()) {
            _cacheTokenRatesIfNecessary();
        }

        return
            super.onExitPool(poolId, sender, recipient, balances, lastChangeBlock, protocolSwapFeePercentage, userData);
    }

    /**
     * @dev Support single- and multi-token exits, but not explicit proportional exits.
     * Note that recovery mode exits do not call`_onExitPool`.
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
        StablePhantomPoolUserData.ExitKindPhantom kind = userData.exitKind();

        (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _payProtocolFeesBeforeJoinExit(balances);

        if (kind == StablePhantomPoolUserData.ExitKindPhantom.BPT_IN_FOR_EXACT_TOKENS_OUT) {
            return _exitBPTInForExactTokensOut(virtualSupply, balancesWithoutBpt, scalingFactors, userData);
        } else if (kind == StablePhantomPoolUserData.ExitKindPhantom.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
            return _exitExactBPTInForTokenOut(virtualSupply, balancesWithoutBpt, userData);
        } else {
            _revert(Errors.UNHANDLED_EXIT_KIND);
        }
    }

    function _exitBPTInForExactTokensOut(
        uint256 virtualSupply,
        uint256[] memory balancesWithoutBpt,
        uint256[] memory scalingFactors,
        bytes memory userData
    ) private returns (uint256, uint256[] memory) {
        (uint256[] memory amountsOut, uint256 maxBPTAmountIn) = userData.bptInForExactTokensOut();
        // amountsOut are unscaled, and do not include BPT
        InputHelpers.ensureInputLengthMatch(amountsOut.length, balancesWithoutBpt.length);

        // The user-provided amountsIn is unscaled and does not include BPT, so we address that.
        (uint256[] memory scaledAmountsOutWithBpt, uint256[] memory scaledAmountsOutWithoutBpt) = _upscaleWithoutBpt(
            amountsOut,
            scalingFactors
        );

        (uint256 currentAmp, ) = _getAmplificationParameter();
        uint256 bptAmountIn = StableMath._calcBptInGivenExactTokensOut(
            currentAmp,
            balancesWithoutBpt,
            scaledAmountsOutWithoutBpt,
            virtualSupply,
            getSwapFeePercentage()
        );
        _require(bptAmountIn <= maxBPTAmountIn, Errors.BPT_IN_MAX_AMOUNT);

        // Subtract amountsOut to get post-exit balances
        _mutateAmounts(balancesWithoutBpt, scaledAmountsOutWithoutBpt, FixedPoint.sub);

        _updateInvariantAfterJoinExit(currentAmp, balancesWithoutBpt);

        return (bptAmountIn, scaledAmountsOutWithBpt);
    }

    function _exitExactBPTInForTokenOut(
        uint256 virtualSupply,
        uint256[] memory balancesWithoutBpt,
        bytes memory userData
    ) private returns (uint256, uint256[] memory) {
        // Since this index is sent in from the user, we interpret it as NOT including the BPT token
        (uint256 bptAmountIn, uint256 tokenIndexWithoutBpt) = userData.exactBptInForTokenOut();
        // Note that there is no minimum amountOut parameter: this is handled by `IVault.exitPool`.

        _require(tokenIndexWithoutBpt < balancesWithoutBpt.length, Errors.OUT_OF_BOUNDS);

        // We exit in a single token, so initialize amountsOut with zeros
        uint256[] memory amountsOut = new uint256[](balancesWithoutBpt.length + 1);
        (uint256 currentAmp, ) = _getAmplificationParameter();

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

        // Subtract amountsOut to get post-exit balances
        _mutateAmounts(balancesWithoutBpt, _dropBptItem(amountsOut), FixedPoint.sub);

        _updateInvariantAfterJoinExit(currentAmp, balancesWithoutBpt);

        return (bptAmountIn, amountsOut);
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
     * @dev Before joins or exits, calculate the invariant using the old rates for exempt tokens (i.e., the rates
     * at the time of the previous join or exit), in order to exclude the yield from the calculation.
     */
    function _payProtocolFeesBeforeJoinExit(uint256[] memory balances) private returns (uint256, uint256[] memory) {
        (uint256 virtualSupply, uint256[] memory balancesWithoutBpt) = _dropBptItemFromBalances(balances);

        // Apply the rate adjustment to exempt tokens: multiply by oldRate / currentRate to "undo" the current scaling,
        // and apply the old rate. This function copies the values in `balancesWithoutBpt and so doesn't mutate it.
        uint256[] memory adjustedBalances = _adjustBalancesByTokenRatios(balancesWithoutBpt);

        uint256 preJoinInvariant = StableMath._calculateInvariant(_postJoinExitAmp, adjustedBalances);

        // Charge the protocol fee in BPT, using the growth in invariant between _postJoinExitInvariant
        // and preJoinInvariant.

        // To convert the protocol swap fees to a BPT amount, we compute the invariant growth (which is due exclusively
        // to swap fees and yield on non-exempt tokens), extract the portion that corresponds to protocol swap fees,
        //  and then compute the equivalent amount of BPT that would cause such an increase.
        //
        // Invariant growth is related to new BPT and supply by:
        // invariant ratio = (bpt amount + supply) / supply
        // With some manipulation, this becomes:
        // (invariant ratio - 1) * supply = bpt amount
        //
        // However, a part of the invariant growth was due to non protocol swap fees (i.e. value accrued by the
        // LPs), so we only mint a percentage of this BPT amount: that which corresponds to protocol fees.

        // We round down, favoring LP fees.

        uint256 invariantRatio = preJoinInvariant.divDown(_postJoinExitInvariant);
        uint256 protocolFeeAmount;
        if (invariantRatio > FixedPoint.ONE) {
            // This condition should always be met outside of rounding errors (for non-zero swap fees).

            protocolFeeAmount = getProtocolSwapFeePercentageCache().mulDown(
                invariantRatio.sub(FixedPoint.ONE).mulDown(virtualSupply)
            );

            _payProtocolFees(protocolFeeAmount);
        }
        // For this addition to overflow, the actual total supply would have already overflowed.
        return (virtualSupply + protocolFeeAmount, balancesWithoutBpt);
    }

    // Store the latest invariant based on the adjusted balances after the join or exit, using current rates.
    // Also cache the amp factor, so that the invariant is not affected by amp updates between joins and exits.
    function _updateInvariantAfterJoinExit(uint256 currentAmp, uint256[] memory balancesWithoutBpt) internal {
        _postJoinExitAmp = currentAmp;
        _postJoinExitInvariant = StableMath._calculateInvariant(currentAmp, balancesWithoutBpt);

        _updateOldRates();
    }

    function _updateOldRates() private {
        // Per the logic in the constructor, we know the flags will be false for
        // indices greater than the actual number of tokens in the pool, and also false
        // for the BPT token.
        //
        // Therefore, we will never call _updateOldRate with the BPT or an invalid token,
        // so no checks need to be done there.

        // prettier-ignore
        {
            if (_exemptFromYieldProtocolFeeToken0) { _updateOldRate(_token0); }
            if (_exemptFromYieldProtocolFeeToken1) { _updateOldRate(_token1); }
            if (_exemptFromYieldProtocolFeeToken2) { _updateOldRate(_token2); }
            if (_exemptFromYieldProtocolFeeToken3) { _updateOldRate(_token3); }
            if (_exemptFromYieldProtocolFeeToken4) { _updateOldRate(_token4); }
            if (_exemptFromYieldProtocolFeeToken5) { _updateOldRate(_token5); }
        }
    }

    // This assumes the token has been validated elsewhere, and is a valid non-BPT token.
    function _updateOldRate(IERC20 token) private {
        bytes32 cache = _tokenRateCaches[token];
        _tokenRateCaches[token] = cache.updateOldRate();
    }

    // Token rate ratios, for protocol fee calculation

    /**
     * @dev Returns whether the token is exempt from protocol fees on the yield.
     * If the BPT token is passed in (which doesn't make much sense, but shouldn't fail,
     * since it is a valid pool token), the corresponding flag will be false.
     */
    function isTokenExemptFromYieldProtocolFee(IERC20 token) external view returns (bool) {
        // prettier-ignore
        {
            if (token == _token0) { return _exemptFromYieldProtocolFeeToken0; }
            else if (token == _token1) { return _exemptFromYieldProtocolFeeToken1; }
            else if (token == _token2) { return _exemptFromYieldProtocolFeeToken2; }
            else if (token == _token3) { return _exemptFromYieldProtocolFeeToken3; }
            else if (token == _token4) { return _exemptFromYieldProtocolFeeToken4; }
            else if (token == _token5) { return _exemptFromYieldProtocolFeeToken5; }
            else {
                _revert(Errors.INVALID_TOKEN);
            }
        }
    }

    /**
     * @dev Apply the token ratios to a set of balances (without BPT), to adjust for any exempt yield tokens.
     * Mutates the balances in place. `_getTokenRateRatios` includes BPT, so we need to remove that ratio to
     * match the cardinality of balancesWithoutBpt.
     */
    function _adjustBalancesByTokenRatios(uint256[] memory balancesWithoutBpt)
        internal
        view
        returns (uint256[] memory)
    {
        uint256[] memory balances = new uint256[](balancesWithoutBpt.length);
        uint256[] memory ratiosWithoutBpt = _dropBptItem(_getTokenRateRatios());
        for (uint256 i = 0; i < balancesWithoutBpt.length; ++i) {
            balances[i] = FixedPoint.mulDown(balancesWithoutBpt[i], ratiosWithoutBpt[i]);
        }
    }

    /**
     * @dev Return the complete set of token ratios (including BPT, which will always be 1).
     */
    function _getTokenRateRatios() internal view returns (uint256[] memory rateRatios) {
        uint256 totalTokens = _getTotalTokens();
        rateRatios = new uint256[](totalTokens);

        // The Pool will always have at least 3 tokens so we always load these three ratios.
        rateRatios[0] = _exemptFromYieldProtocolFeeToken0
            ? _computeRateRatio(_tokenRateCaches[_token0])
            : FixedPoint.ONE;
        rateRatios[1] = _exemptFromYieldProtocolFeeToken1
            ? _computeRateRatio(_tokenRateCaches[_token1])
            : FixedPoint.ONE;
        rateRatios[2] = _exemptFromYieldProtocolFeeToken2
            ? _computeRateRatio(_tokenRateCaches[_token2])
            : FixedPoint.ONE;

        // Before we load the remaining ratios we must check that the Pool contains enough tokens.
        if (totalTokens == 3) return rateRatios;
        rateRatios[3] = _exemptFromYieldProtocolFeeToken3
            ? _computeRateRatio(_tokenRateCaches[_token3])
            : FixedPoint.ONE;

        if (totalTokens == 4) return rateRatios;
        rateRatios[4] = _exemptFromYieldProtocolFeeToken4
            ? _computeRateRatio(_tokenRateCaches[_token4])
            : FixedPoint.ONE;

        if (totalTokens == 5) return rateRatios;
        rateRatios[5] = _exemptFromYieldProtocolFeeToken5
            ? _computeRateRatio(_tokenRateCaches[_token5])
            : FixedPoint.ONE;
    }

    function _computeRateRatio(bytes32 cache) private pure returns (uint256) {
        return cache.getOldRate().divUp(cache.getCurrentRate());
    }

    // Token rates

    /**
     * @dev Returns the rate providers configured for each token (in the same order as registered).
     */
    function getRateProviders() external view returns (IRateProvider[] memory providers) {
        uint256 totalTokens = _getTotalTokens();
        providers = new IRateProvider[](totalTokens);

        // prettier-ignore
        {
            providers[0] = _rateProvider0;
            providers[1] = _rateProvider1;
            providers[2] = _rateProvider2;
            if (totalTokens > 3) { providers[3] = _rateProvider3; } else { return providers; }
            if (totalTokens > 4) { providers[4] = _rateProvider4; } else { return providers; }
            if (totalTokens > 5) { providers[5] = _rateProvider5; } else { return providers; }
        }
    }

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

    function _getRateProvider(IERC20 token) internal view returns (IRateProvider) {
        if (token == _token0) return _rateProvider0;
        if (token == _token1) return _rateProvider1;
        if (token == _token2) return _rateProvider2;
        if (token == _token3) return _rateProvider3;
        if (token == _token4) return _rateProvider4;
        if (token == _token5) return _rateProvider5;
        else {
            _revert(Errors.INVALID_TOKEN);
        }
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
            _cacheTokenRateIfNecessary(_token0);
            _cacheTokenRateIfNecessary(_token1);
            _cacheTokenRateIfNecessary(_token2);
            if (totalTokens > 3) { _cacheTokenRateIfNecessary(_token3); } else { return; }
            if (totalTokens > 4) { _cacheTokenRateIfNecessary(_token4); } else { return; }
            if (totalTokens > 5) { _cacheTokenRateIfNecessary(_token5); } else { return; }
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
        uint256 scalingFactor;

        // prettier-ignore
        if (token == _token0) { scalingFactor = _getScalingFactor0(); }
        else if (token == _token1) { scalingFactor = _getScalingFactor1(); }
        else if (token == _token2) { scalingFactor = _getScalingFactor2(); }
        else if (token == _token3) { scalingFactor = _getScalingFactor3(); }
        else if (token == _token4) { scalingFactor = _getScalingFactor4(); }
        else if (token == _token5) { scalingFactor = _getScalingFactor5(); }
        else {
            _revert(Errors.INVALID_TOKEN);
        }

        return scalingFactor.mulDown(getTokenRate(token));
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
        scalingFactors[0] = _getScalingFactor0().mulDown(getTokenRate(_token0));
        scalingFactors[1] = _getScalingFactor1().mulDown(getTokenRate(_token1));
        scalingFactors[2] = _getScalingFactor2().mulDown(getTokenRate(_token2));

        // Before we load the remaining scaling factors we must check that the Pool contains enough tokens.
        if (totalTokens == 3) return scalingFactors;
        scalingFactors[3] = _getScalingFactor3().mulDown(getTokenRate(_token3));

        if (totalTokens == 4) return scalingFactors;
        scalingFactors[4] = _getScalingFactor4().mulDown(getTokenRate(_token4));

        if (totalTokens == 5) return scalingFactors;
        scalingFactors[5] = _getScalingFactor5().mulDown(getTokenRate(_token5));
    }

    function _getScalingFactor0() internal view returns (uint256) {
        return _scalingFactor0;
    }

    function _getScalingFactor1() internal view returns (uint256) {
        return _scalingFactor1;
    }

    function _getScalingFactor2() internal view returns (uint256) {
        return _scalingFactor2;
    }

    function _getScalingFactor3() internal view returns (uint256) {
        return _scalingFactor3;
    }

    function _getScalingFactor4() internal view returns (uint256) {
        return _scalingFactor4;
    }

    function _getScalingFactor5() internal view returns (uint256) {
        return _scalingFactor5;
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
     * @dev Upscales an amounts array that does not include BPT (e.g. an `amountsIn` array for a join). Returns two
     * scaled arrays, one with BPT (with a BPT amount of 0), and one without BPT).
     */
    function _upscaleWithoutBpt(uint256[] memory unscaledWithoutBpt, uint256[] memory scalingFactors)
        internal
        view
        returns (uint256[] memory scaledWithBpt, uint256[] memory scaledWithoutBpt)
    {
        // The scaling factors include BPT, so in order to apply them we must first insert BPT at the correct position.
        scaledWithBpt = _addBptItem(unscaledWithoutBpt, 0);
        _upscaleArray(scaledWithBpt, scalingFactors);

        scaledWithoutBpt = _dropBptItem(scaledWithBpt);
    }

    // Convert from an index into an array including BPT (the Vault's registered token list), to an index
    // into an array excluding BPT (usually from user input, such as amountsIn/Out).
    // `index` must not be the BPT token index itself.
    function _skipBptIndex(uint256 index) internal view returns (uint256) {
        // Currently this is never called with an index passed in from user input, so this check
        // should not be necessary. Included for completion (and future proofing).
        _require(index != _bptIndex, Errors.OUT_OF_BOUNDS);

        return index < _bptIndex ? index : index.sub(1);
    }

    // Convert from an index into an array excluding BPT (usually from user input, such as amountsIn/Out),
    // to an index into an array excluding BPT (the Vault's registered token list).
    // `index` must not be the BPT token index itself, if it is the last element, and the result must be
    // in the range of registered tokens.
    function _addBptIndex(uint256 index) internal view returns (uint256 indexWithBpt) {
        // This can be called from an index passed in from user input.
        indexWithBpt = index < _bptIndex ? index : index.add(1);

        _require(indexWithBpt < _getTotalTokens() && indexWithBpt != _bptIndex, Errors.OUT_OF_BOUNDS);
    }

    /**
     * @dev Remove the item at `_bptIndex` from an arbitrary array (e.g., amountsIn).
     */
    function _dropBptItem(uint256[] memory amounts) internal view returns (uint256[] memory) {
        uint256[] memory amountsWithoutBpt = new uint256[](amounts.length - 1);
        for (uint256 i = 0; i < amountsWithoutBpt.length; i++) {
            amountsWithoutBpt[i] = amounts[i < _bptIndex ? i : i + 1];
        }

        return amountsWithoutBpt;
    }

    /**
     * @dev Same as `_dropBptItem`, except the virtual supply is also returned, and `balances` is assumed to be the
     * current Pool balances.
     */
    function _dropBptItemFromBalances(uint256[] memory balances) internal view returns (uint256, uint256[] memory) {
        return (_getVirtualSupply(balances[_bptIndex]), _dropBptItem(balances));
    }

    function _addBptItem(uint256[] memory amounts, uint256 bptAmount)
        internal
        view
        returns (uint256[] memory amountsWithBpt)
    {
        amountsWithBpt = new uint256[](amounts.length + 1);
        for (uint256 i = 0; i < amountsWithBpt.length; i++) {
            amountsWithBpt[i] = i == _bptIndex ? bptAmount : amounts[i < _bptIndex ? i : i - 1];
        }
    }

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
}
