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

import "@balancer-labs/v2-pool-stable/contracts/StableMath.sol";

/**
 * @dev StablePool with preminted BPT and rate providers for each token, allowing for e.g. wrapped tokens with a known
 * price ratio, such as Compound's cTokens.
 *
 * BPT is preminted on Pool initialization and registered as one of the Pool's tokens, allowing for swaps to behave as
 * single-token joins or exits (by swapping a token for BPT). Regular joins and exits are disabled, since no BPT is
 * minted or burned after initialization.
 *
 * Preminted BPT is sometimes called Phantom BPT, as the preminted BPT (which is deposited in the Vault as balance of
 * the Pool) doesn't belong to any entity until transferred out of the Pool. The Pool's arithmetic behaves as if it
 * didn't exist, and the BPT total supply is not a useful value: we rely on the 'virtual supply' (how much BPT is
 * actually owned by some entity) instead.
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

    bytes32 private _packedAmplificationData;

    event AmpUpdateStarted(uint256 startValue, uint256 endValue, uint256 startTime, uint256 endTime);
    event AmpUpdateStopped(uint256 currentValue);

    // Token rate caches are used to avoid querying the price rate for a token every time we need to work with it.
    // Data is stored with the following structure:
    //
    // [   expires   | duration | price rate value ]
    // [   uint64    |  uint64  |      uint128     ]

    mapping(IERC20 => bytes32) private _tokenRateCaches;

    IRateProvider internal immutable _rateProvider0;
    IRateProvider internal immutable _rateProvider1;
    IRateProvider internal immutable _rateProvider2;
    IRateProvider internal immutable _rateProvider3;
    IRateProvider internal immutable _rateProvider4;
    IRateProvider internal immutable _rateProvider5;

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
        IRateProvider[] memory tokensAndBPTRateProviders = new IRateProvider[](params.tokens.length + 1);
        for (uint256 i = 0; i < tokensAndBPTRateProviders.length; ++i) {
            if (i < bptIndex) {
                tokensAndBPTRateProviders[i] = params.rateProviders[i];
            } else if (i == bptIndex) {
                tokensAndBPTRateProviders[i] = IRateProvider(0);
            } else {
                tokensAndBPTRateProviders[i] = params.rateProviders[i - 1];
            }
        }

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _rateProvider0 = tokensAndBPTRateProviders[0];
        _rateProvider1 = tokensAndBPTRateProviders[1];
        _rateProvider2 = tokensAndBPTRateProviders[2];
        _rateProvider3 = (tokensAndBPTRateProviders.length > 3) ? tokensAndBPTRateProviders[3] : IRateProvider(0);
        _rateProvider4 = (tokensAndBPTRateProviders.length > 4) ? tokensAndBPTRateProviders[4] : IRateProvider(0);
        _rateProvider5 = (tokensAndBPTRateProviders.length > 5) ? tokensAndBPTRateProviders[5] : IRateProvider(0);
    }

    function getMinimumBpt() external pure returns (uint256) {
        return _getMinimumBpt();
    }

    function getBptIndex() external view returns (uint256) {
        return _bptIndex;
    }

    // Typically, `_onSwapGivenIn` and `_onSwapGivenOut` handlers are meant to process swaps between Pool tokens.
    // Since one of the Pool's tokens is the preminted BPT, we neeed to a) handle swaps where that tokens is involved
    // separately (as they are effectively single-token joins or exits), and b) remove BPT from the balances array when
    // processing regular swaps before calling the StableMath functions.
    //
    // Only single-token joins and exits are supported, and these are expected to occur very frequently due to the BPT
    // of this Pool being included in other Pools. Because of this, we compute protocol fees in a relatively
    // straightforward way instead of trying to measure invariant growth between joins and exits.
    // Recall that due protocol fees are expressed as BPT amounts: for any swap involving BPT, we simply add the
    // corresponding protocol swap fee to that amount, and for swaps without BPT we convert the fee amount to the
    // equivalent BPT amount. Note that swap fees are charged by BaseGeneralPool.
    //
    // The given in and given out handlers are quite similar and could use an intermediate abstraction, but keeping the
    // duplication seems to lead to more readable code, given the number of variants at play.

    function _onSwapGivenIn(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override whenNotPaused returns (uint256 amountOut) {
        _cacheTokenRatesIfNecessary();

        uint256 protocolSwapFeePercentage = _getProtocolSwapFeePercentage();

        // Compute virtual BPT supply and token balances (sans BPT).
        (uint256 virtualSupply, uint256[] memory balances) = _dropBptItemFromBalances(balancesIncludingBpt);

        if (request.tokenIn == IERC20(this)) {
            amountOut = _onSwapTokenGivenBptIn(request.amount, _skipBptIndex(indexOut), virtualSupply, balances);

            // For given in swaps, request.amount holds the amount in.
            if (protocolSwapFeePercentage > 0) {
                _payDueProtocolFeeByBpt(request.amount, protocolSwapFeePercentage);
            }
        } else if (request.tokenOut == IERC20(this)) {
            amountOut = _onSwapBptGivenTokenIn(request.amount, _skipBptIndex(indexIn), virtualSupply, balances);

            if (protocolSwapFeePercentage > 0) {
                _payDueProtocolFeeByBpt(amountOut, protocolSwapFeePercentage);
            }
        } else {
            // To compute accrued protocol fees in BPT, we measure the invariant before and after the swap, then compute
            // the equivalent BPT amount that accounts for that growth and finally extract the percentage that
            // corresponds to protocol fees.

            (uint256 currentAmp, ) = _getAmplificationParameter();
            uint256 invariant = StableMath._calculateInvariant(currentAmp, balances);

            amountOut = StableMath._calcOutGivenIn(
                currentAmp,
                balances,
                _skipBptIndex(indexIn),
                _skipBptIndex(indexOut),
                request.amount,
                invariant
            );

            if (protocolSwapFeePercentage > 0) {
                // We could've stored these indices in stack variables, but that causes stack-too-deep issues.
                uint256 newIndexIn = _skipBptIndex(indexIn);
                uint256 newIndexOut = _skipBptIndex(indexOut);

                uint256 amountInWithFee = _addSwapFeeAmount(request.amount);
                balances[newIndexIn] = balances[newIndexIn].add(amountInWithFee);
                balances[newIndexOut] = balances[newIndexOut].sub(amountOut);

                _payDueProtocolFeeByInvariantIncrement(
                    invariant,
                    currentAmp,
                    balances,
                    virtualSupply,
                    protocolSwapFeePercentage
                );
            }
        }
    }

    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override whenNotPaused returns (uint256 amountIn) {
        _cacheTokenRatesIfNecessary();

        uint256 protocolSwapFeePercentage = _getProtocolSwapFeePercentage();

        // Compute virtual BPT supply and token balances (sans BPT).
        (uint256 virtualSupply, uint256[] memory balances) = _dropBptItemFromBalances(balancesIncludingBpt);

        if (request.tokenIn == IERC20(this)) {
            amountIn = _onSwapBptGivenTokenOut(request.amount, _skipBptIndex(indexOut), virtualSupply, balances);

            if (protocolSwapFeePercentage > 0) {
                _payDueProtocolFeeByBpt(amountIn, protocolSwapFeePercentage);
            }
        } else if (request.tokenOut == IERC20(this)) {
            amountIn = _onSwapTokenGivenBptOut(request.amount, _skipBptIndex(indexIn), virtualSupply, balances);

            // For given out swaps, request.amount holds the amount out.
            if (protocolSwapFeePercentage > 0) {
                _payDueProtocolFeeByBpt(request.amount, protocolSwapFeePercentage);
            }
        } else {
            // To compute accrued protocol fees in BPT, we measure the invariant before and after the swap, then compute
            // the equivalent BPT amount that accounts for that growth and finally extract the percentage that
            // corresponds to protocol fees.

            (uint256 currentAmp, ) = _getAmplificationParameter();
            uint256 invariant = StableMath._calculateInvariant(currentAmp, balances);

            amountIn = StableMath._calcInGivenOut(
                currentAmp,
                balances,
                _skipBptIndex(indexIn),
                _skipBptIndex(indexOut),
                request.amount,
                invariant
            );

            if (protocolSwapFeePercentage > 0) {
                // We could've stored these indices in stack variables, but that causes stack-too-deep issues.
                uint256 newIndexIn = _skipBptIndex(indexIn);
                uint256 newIndexOut = _skipBptIndex(indexOut);

                uint256 amountInWithFee = _addSwapFeeAmount(amountIn);
                balances[newIndexIn] = balances[newIndexIn].add(amountInWithFee);
                balances[newIndexOut] = balances[newIndexOut].sub(request.amount);

                _payDueProtocolFeeByInvariantIncrement(
                    invariant,
                    currentAmp,
                    balances,
                    virtualSupply,
                    protocolSwapFeePercentage
                );
            }
        }
    }

    /**
     * @notice Returns the protocol swap fee percentage.
     * @dev This is typically the cached value, but it is zeroed-out while the Pool is in recovery mode, imitating
     * the behavior in BasePool. The cache should not be used directly - all protocol fee queries should be made
     * using this function.
     */
    function _getProtocolSwapFeePercentage() internal view returns (uint256) {
        return inRecoveryMode() ? 0 : getProtocolSwapFeePercentageCache();
    }

    /**
     * @dev Calculate token out for exact BPT in (exit)
     */
    function _onSwapTokenGivenBptIn(
        uint256 bptIn,
        uint256 tokenIndex,
        uint256 virtualSupply,
        uint256[] memory balances
    ) internal view returns (uint256 amountOut) {
        // Use virtual total supply and zero swap fees for joins.
        (uint256 amp, ) = _getAmplificationParameter();
        amountOut = StableMath._calcTokenOutGivenExactBptIn(amp, balances, tokenIndex, bptIn, virtualSupply, 0);
    }

    /**
     * @dev Calculate token in for exact BPT out (join)
     */
    function _onSwapTokenGivenBptOut(
        uint256 bptOut,
        uint256 tokenIndex,
        uint256 virtualSupply,
        uint256[] memory balances
    ) internal view returns (uint256 amountIn) {
        // Use virtual total supply and zero swap fees for joins
        (uint256 amp, ) = _getAmplificationParameter();
        amountIn = StableMath._calcTokenInGivenExactBptOut(amp, balances, tokenIndex, bptOut, virtualSupply, 0);
    }

    /**
     * @dev Calculate BPT in for exact token out (exit)
     */
    function _onSwapBptGivenTokenOut(
        uint256 amountOut,
        uint256 tokenIndex,
        uint256 virtualSupply,
        uint256[] memory balances
    ) internal view returns (uint256 bptIn) {
        // Avoid BPT balance for stable pool math. Use virtual total supply and zero swap fees for exits.
        (uint256 amp, ) = _getAmplificationParameter();
        uint256[] memory amountsOut = new uint256[](_getTotalTokens() - 1);
        amountsOut[tokenIndex] = amountOut;
        bptIn = StableMath._calcBptInGivenExactTokensOut(amp, balances, amountsOut, virtualSupply, 0);
    }

    /**
     * @dev Calculate BPT out for exact token in (join)
     */
    function _onSwapBptGivenTokenIn(
        uint256 amountIn,
        uint256 tokenIndex,
        uint256 virtualSupply,
        uint256[] memory balances
    ) internal view returns (uint256 bptOut) {
        uint256[] memory amountsIn = new uint256[](_getTotalTokens() - 1);
        amountsIn[tokenIndex] = amountIn;
        (uint256 amp, ) = _getAmplificationParameter();
        bptOut = StableMath._calcBptOutGivenExactTokensIn(amp, balances, amountsIn, virtualSupply, 0);
    }

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
    ) internal override whenNotPaused returns (uint256, uint256[] memory) {
        StablePhantomPoolUserData.JoinKindPhantom kind = userData.joinKind();
        _require(kind == StablePhantomPoolUserData.JoinKindPhantom.INIT, Errors.UNINITIALIZED);

        uint256[] memory amountsInIncludingBpt = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsInIncludingBpt.length, _getTotalTokens());
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

        return (bptAmountOut, amountsInIncludingBpt);
    }

    /**
     * @dev Supports multi-token joins, plus the special join kind that simply pays due protocol fees to the Vault.
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
        InputHelpers.ensureInputLengthMatch(_getTotalTokens() - 1, amountsIn.length);

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
        } else {
            _revert(Errors.UNHANDLED_EXIT_KIND);
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
        InputHelpers.ensureInputLengthMatch(amountsOut.length, _getTotalTokens() - 1);

        // The user-provided amountsIn is unscaled and does not include BPT, so we address that.
        (uint256[] memory scaledAmountsOutWithBpt, uint256[] memory scaledAmountsOutWithoutBpt) = _upscaleWithoutBpt(
            amountsOut,
            scalingFactors
        );

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

    // Scaling factors

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

        // Given there is no generic direction for this rounding, it follows the same strategy as the BasePool.
        // prettier-ignore
        {
            scalingFactors[0] = _getScalingFactor0().mulDown(getTokenRate(_token0));
            scalingFactors[1] = _getScalingFactor1().mulDown(getTokenRate(_token1));
            scalingFactors[2] = _getScalingFactor2().mulDown(getTokenRate(_token2));
            if (totalTokens > 3) {
                scalingFactors[3] = _getScalingFactor3().mulDown(getTokenRate(_token3));
            } else { return scalingFactors; }
            if (totalTokens > 4) {
                scalingFactors[4] = _getScalingFactor4().mulDown(getTokenRate(_token4));
            } else { return scalingFactors; }
            if (totalTokens > 5) {
                scalingFactors[5] = _getScalingFactor5().mulDown(getTokenRate(_token5));
            } else { return scalingFactors; }
        }
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

    function _getRateProvider(IERC20 token) internal view returns (IRateProvider) {
        // prettier-ignore
        if (token == _token0) { return _rateProvider0; }
        else if (token == _token1) { return _rateProvider1; }
        else if (token == _token2) { return _rateProvider2; }
        else if (token == _token3) { return _rateProvider3; }
        else if (token == _token4) { return _rateProvider4; }
        else if (token == _token5) { return _rateProvider5; }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    /**
     * @dev Returns the token rate for token. All token rates are fixed-point values with 18 decimals.
     * In case there is no rate provider for the provided token it returns 1e18.
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
        return tokenRateCache == bytes32(0) ? FixedPoint.ONE : tokenRateCache.getRate();
    }

    /**
     * @dev Returns the cached value for token's rate.
     * Note it could return an empty value if the requested token does not have one or if the token does not belong
     * to the pool.
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

        rate = _tokenRateCaches[token].getRate();
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
        bytes32 cache = PriceRateCache.encode(rate, duration);
        _tokenRateCaches[token] = cache;
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

    /**
     * @dev Overrides only owner action to allow setting the cache duration for the token rates
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view virtual override returns (bool) {
        return
            (actionId == getActionId(this.setTokenRateCacheDuration.selector)) ||
            (actionId == getActionId(this.startAmplificationParameterUpdate.selector)) ||
            (actionId == getActionId(this.stopAmplificationParameterUpdate.selector)) ||
            super._isOwnerOnlyAction(actionId);
    }

    function _skipBptIndex(uint256 index) internal view returns (uint256) {
        return index < _bptIndex ? index : index.sub(1);
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

    /**
     * @dev Returns the number of tokens in circulation.
     *
     * In other pools, this would be the same as `totalSupply`, but since this pool pre-mints all BPT, `totalSupply`
     * remains constant, whereas `getVirtualSupply` increases as users join the pool and decreases as they exit it.
     */
    function getVirtualSupply() external view returns (uint256) {
        (, uint256[] memory balances, ) = getVault().getPoolTokens(getPoolId());
        // Note that unlike all other balances, the Vault's BPT balance does not need scaling as its scaling factor is
        // one.
        return _getVirtualSupply(balances[_bptIndex]);
    }

    // The initial amount of BPT pre-minted is _PREMINTED_TOKEN_BALANCE, and it goes entirely to the pool balance in the
    // vault. So the virtualSupply (the actual supply in circulation) is defined as:
    // virtualSupply = totalSupply() - _balances[_bptIndex]
    function _getVirtualSupply(uint256 bptBalance) internal view returns (uint256) {
        return totalSupply().sub(bptBalance);
    }

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

    // Amplification

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

    function _getMaxTokens() internal pure override returns (uint256) {
        // The BPT will be one of the Pool tokens, but it is unaffected by the Stable 5 token limit.
        return StableMath._MAX_STABLE_TOKENS + 1;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _totalTokens;
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
            WordCodec.encodeUint(startValue, 0, 64) |
            WordCodec.encodeUint(endValue, 64, 64) |
            WordCodec.encodeUint(startTime, 64 * 2, 64) |
            WordCodec.encodeUint(endTime, 64 * 3, 64);
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
        startValue = _packedAmplificationData.decodeUint(0, 64);
        endValue = _packedAmplificationData.decodeUint(64, 64);
        startTime = _packedAmplificationData.decodeUint(64 * 2, 64);
        endTime = _packedAmplificationData.decodeUint(64 * 3, 64);
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
}
