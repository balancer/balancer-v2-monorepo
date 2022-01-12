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

import "@balancer-labs/v2-pool-stable/contracts/StablePool.sol";
import "@balancer-labs/v2-pool-utils/contracts/rates/PriceRateCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/interfaces/IRateProvider.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";

import "./StablePhantomPoolUserDataHelpers.sol";

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
contract StablePhantomPool is StablePool {
    using FixedPoint for uint256;
    using PriceRateCache for bytes32;
    using StablePhantomPoolUserDataHelpers for bytes;

    uint256 private constant _MIN_TOKENS = 2;
    uint256 private constant _MAX_TOKEN_BALANCE = 2**(112) - 1;

    uint256 private immutable _bptIndex;

    // Since this Pool is not joined or exited via the regular onJoinPool and onExitPool hooks, it lacks a way to
    // continuously pay due protocol fees. Instead, it keeps track of those internally.
    // Due protocol fees are expressed in BPT, which leads to reduced gas costs when compared to tracking due fees for
    // each Pool token. This means that some of the BPT deposited in the Vault for the Pool is part of the 'virtual'
    // supply, as it belongs to the protocol.
    uint256 private _dueProtocolFeeBptAmount;

    // The Vault does not provide the protocol swap fee percentage in swap hooks (as swaps don't typically need this
    // value), so we need to fetch it ourselves from the Vault's ProtocolFeeCollector. However, this value changes so
    // rarely that it doesn't make sense to perform the required calls to get the current value in every single swap.
    // Instead, we keep a local copy that can be permissionlessly updated by anyone with the real value.
    uint256 private _cachedProtocolSwapFeePercentage;

    event CachedProtocolSwapFeePercentageUpdated(uint256 protocolSwapFeePercentage);

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

    event TokenRateCacheUpdated(IERC20 indexed token, uint256 rate);
    event TokenRateProviderSet(IERC20 indexed token, IRateProvider indexed provider, uint256 cacheDuration);
    event DueProtocolFeeIncreased(uint256 bptAmount);

    enum JoinKindPhantom { INIT, COLLECT_PROTOCOL_FEES }
    enum ExitKindPhantom { EXACT_BPT_IN_FOR_TOKENS_OUT }

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
        StablePool(
            params.vault,
            params.name,
            params.symbol,
            _insertSorted(params.tokens, IERC20(this)),
            params.amplificationParameter,
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
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
        _rateProvider0 = (tokensAndBPTRateProviders.length > 0) ? tokensAndBPTRateProviders[0] : IRateProvider(0);
        _rateProvider1 = (tokensAndBPTRateProviders.length > 1) ? tokensAndBPTRateProviders[1] : IRateProvider(0);
        _rateProvider2 = (tokensAndBPTRateProviders.length > 2) ? tokensAndBPTRateProviders[2] : IRateProvider(0);
        _rateProvider3 = (tokensAndBPTRateProviders.length > 3) ? tokensAndBPTRateProviders[3] : IRateProvider(0);
        _rateProvider4 = (tokensAndBPTRateProviders.length > 4) ? tokensAndBPTRateProviders[4] : IRateProvider(0);

        _updateCachedProtocolSwapFeePercentage(params.vault);
    }

    function getMinimumBpt() external pure returns (uint256) {
        return _getMinimumBpt();
    }

    function getBptIndex() external view returns (uint256) {
        return _bptIndex;
    }

    function getDueProtocolFeeBptAmount() external view returns (uint256) {
        return _dueProtocolFeeBptAmount;
    }

    /**
     * @dev StablePools with two tokens may use the IMinimalSwapInfoPool interface. This should never happen since this
     * Pool has a minimum of three tokens, but we override and revert unconditionally in this handler anyway.
     */
    function onSwap(
        SwapRequest memory,
        uint256,
        uint256
    ) public pure override returns (uint256) {
        _revert(Errors.UNHANDLED_BY_PHANTOM_POOL);
    }

    // StablePool's `_onSwapGivenIn` and `_onSwapGivenOut` handlers are meant to process swaps between Pool tokens.
    // Since one of the Pool's tokens is the preminted BPT, we neeed to a) handle swaps where that tokens is involved
    // separately (as they are effectively single-token joins or exits), and b) remove BPT from the balances array when
    // processing regular swaps before delegating those to StablePool's handler.
    //
    // Since StablePools don't accurately track protocol fees in single-token joins and exit, and not only does this
    // Pool not support multi-token joins or exits, but also they are expected to be much more prevalent, we compute
    // protocol fees in a different and more straightforward way. Recall that due protocol fees are expressed as BPT
    // amounts: for any swap involving BPT, we simply add the corresponding protocol swap fee to that amount, and for
    // swaps without BPT we convert the fee amount to the equivalent BPT amount. Note that swap fees are charged by
    // BaseGeneralPool.
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

        uint256 protocolSwapFeePercentage = _cachedProtocolSwapFeePercentage;

        // Compute virtual BPT supply and token balances (sans BPT).
        (uint256 virtualSupply, uint256[] memory balances) = _dropBptItem(balancesIncludingBpt);

        if (request.tokenIn == IERC20(this)) {
            amountOut = _onSwapTokenGivenBptIn(request.amount, _skipBptIndex(indexOut), virtualSupply, balances);

            // For given in swaps, request.amount holds the amount in.
            if (protocolSwapFeePercentage > 0) {
                _trackDueProtocolFeeByBpt(request.amount, protocolSwapFeePercentage);
            }
        } else if (request.tokenOut == IERC20(this)) {
            amountOut = _onSwapBptGivenTokenIn(request.amount, _skipBptIndex(indexIn), virtualSupply, balances);

            if (protocolSwapFeePercentage > 0) {
                _trackDueProtocolFeeByBpt(amountOut, protocolSwapFeePercentage);
            }
        } else {
            // To compute accrued protocol fees in BPT, we measure the invariant before and after the swap, then compute
            // the equivalent BPT amount that accounts for that growth and finally extract the percentage that
            // corresponds to protocol fees.

            // Since the original StablePool._onSwapGivenIn implementation already computes the invariant, we fully
            // replace it and reimplement it here to take advantage of that.

            (uint256 currentAmp, ) = _getAmplificationParameter();
            uint256 invariant = StableMath._calculateInvariant(currentAmp, balances, true);

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

                _trackDueProtocolFeeByInvariantIncrement(
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

        uint256 protocolSwapFeePercentage = _cachedProtocolSwapFeePercentage;

        // Compute virtual BPT supply and token balances (sans BPT).
        (uint256 virtualSupply, uint256[] memory balances) = _dropBptItem(balancesIncludingBpt);

        if (request.tokenIn == IERC20(this)) {
            amountIn = _onSwapBptGivenTokenOut(request.amount, _skipBptIndex(indexOut), virtualSupply, balances);

            if (protocolSwapFeePercentage > 0) {
                _trackDueProtocolFeeByBpt(amountIn, protocolSwapFeePercentage);
            }
        } else if (request.tokenOut == IERC20(this)) {
            amountIn = _onSwapTokenGivenBptOut(request.amount, _skipBptIndex(indexIn), virtualSupply, balances);

            // For given out swaps, request.amount holds the amount out.
            if (protocolSwapFeePercentage > 0) {
                _trackDueProtocolFeeByBpt(request.amount, protocolSwapFeePercentage);
            }
        } else {
            // To compute accrued protocol fees in BPT, we measure the invariant before and after the swap, then compute
            // the equivalent BPT amount that accounts for that growth and finally extract the percentage that
            // corresponds to protocol fees.

            // Since the original StablePool._onSwapGivenOut implementation already computes the invariant, we fully
            // replace it and reimplement it here to take advtange of that.

            (uint256 currentAmp, ) = _getAmplificationParameter();
            uint256 invariant = StableMath._calculateInvariant(currentAmp, balances, true);

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

                _trackDueProtocolFeeByInvariantIncrement(
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
     * @dev Tracks newly charged protocol fees after a swap where BPT was not involved (i.e. a regular swap).
     */
    function _trackDueProtocolFeeByInvariantIncrement(
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

        uint256 postSwapInvariant = StableMath._calculateInvariant(amp, postSwapBalances, false);
        uint256 invariantRatio = postSwapInvariant.divDown(previousInvariant);

        if (invariantRatio > FixedPoint.ONE) {
            // This condition should always be met outside of rounding errors (for non-zero swap fees).

            uint256 protocolFeeAmount = protocolSwapFeePercentage.mulDown(
                invariantRatio.sub(FixedPoint.ONE).mulDown(virtualSupply)
            );

            _dueProtocolFeeBptAmount = _dueProtocolFeeBptAmount.add(protocolFeeAmount);

            emit DueProtocolFeeIncreased(protocolFeeAmount);
        }
    }

    /**
     * @dev Tracks newly charged protocol fees after a swap where `bptAmount` was either sent or received (i.e. a
     * single-token join or exit).
     */
    function _trackDueProtocolFeeByBpt(uint256 bptAmount, uint256 protocolSwapFeePercentage) private {
        uint256 feeAmount = _addSwapFeeAmount(bptAmount).sub(bptAmount);

        uint256 protocolFeeAmount = feeAmount.mulDown(protocolSwapFeePercentage);
        _dueProtocolFeeBptAmount = _dueProtocolFeeBptAmount.add(protocolFeeAmount);

        emit DueProtocolFeeIncreased(protocolFeeAmount);
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
        StablePhantomPool.JoinKindPhantom kind = userData.joinKind();
        _require(kind == StablePhantomPool.JoinKindPhantom.INIT, Errors.UNINITIALIZED);

        uint256[] memory amountsInIncludingBpt = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsInIncludingBpt.length, _getTotalTokens());
        _upscaleArray(amountsInIncludingBpt, scalingFactors);

        (uint256 amp, ) = _getAmplificationParameter();
        (, uint256[] memory amountsIn) = _dropBptItem(amountsInIncludingBpt);
        // The true argument in the _calculateInvariant call instructs it to round up
        uint256 invariantAfterJoin = StableMath._calculateInvariant(amp, amountsIn, true);

        // Set the initial BPT to the value of the invariant
        uint256 bptAmountOut = invariantAfterJoin;

        // BasePool will mint bptAmountOut for the sender: we then also mint the remaining BPT to make up for the total
        // supply, and have the Vault pull those tokens from the sender as part of the join.
        // Note that the sender need not approve BPT for the Vault as the Vault already has infinite BPT allowance for
        // all accounts.
        uint256 initialBpt = _MAX_TOKEN_BALANCE.sub(bptAmountOut);
        _mintPoolTokens(sender, initialBpt);
        amountsInIncludingBpt[_bptIndex] = initialBpt;

        return (bptAmountOut, amountsInIncludingBpt);
    }

    /**
     * @dev Revert on all joins, except for the special join kind that simply pays due protocol fees to the Vault.
     */
    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory userData
    )
        internal
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        JoinKindPhantom kind = userData.joinKind();

        if (kind == JoinKindPhantom.COLLECT_PROTOCOL_FEES) {
            return _collectProtocolFees();
        }

        _revert(Errors.UNHANDLED_BY_PHANTOM_POOL);
    }

    /**
     * @dev Collects due protocol fees
     */

    function _collectProtocolFees()
        private
        returns (
            uint256 bptOut,
            uint256[] memory amountsIn,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
        uint256 totalTokens = _getTotalTokens();

        // This join neither grants BPT nor takes any tokens from the sender.
        bptOut = 0;
        amountsIn = new uint256[](totalTokens);

        // Due protocol fees are all zero except for the BPT amount, which is then zeroed out.
        dueProtocolFeeAmounts = new uint256[](totalTokens);
        dueProtocolFeeAmounts[_bptIndex] = _dueProtocolFeeBptAmount;
        _dueProtocolFeeBptAmount = 0;
    }

    /**
     * @dev Revert on all exits.
     */
    function _onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory balances,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory userData
    )
        internal
        view
        override
        returns (
            uint256 bptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
        ExitKindPhantom kind = userData.exitKind();

        // Exits typically revert, except for the proportional exit when the emergency pause mechanism has been
        // triggered. This allows for a simple and safe way to exit the Pool.
        if (kind == ExitKindPhantom.EXACT_BPT_IN_FOR_TOKENS_OUT) {
            _ensurePaused();

            // Note that this will cause the user's BPT to be burned, which is not something that happens during
            // regular operation of this Pool, and may lead to accounting errors. Because of this, it is highly
            // advisable to stop using a Pool after it is paused and the pause window expires.

            (bptAmountIn, amountsOut) = _proportionalExit(balances, userData);
            // For simplicity, due protocol fees are set to zero.
            dueProtocolFeeAmounts = new uint256[](_getTotalTokens());
        } else {
            _revert(Errors.UNHANDLED_BY_PHANTOM_POOL);
        }
    }

    function _proportionalExit(uint256[] memory balances, bytes memory userData)
        private
        view
        returns (uint256, uint256[] memory)
    {
        // This proportional exit function is only enabled if the contract is paused, to provide users a way to
        // retrieve their tokens in case of an emergency.
        //
        // This particular exit function is the only one available because it is the simplest, and therefore least
        // likely to be incorrect, or revert and lock funds.
        (, uint256[] memory balancesWithoutBpt) = _dropBptItem(balances);

        uint256 bptAmountIn = userData.exactBptInForTokensOut();
        // Note that there is no minimum amountOut parameter: this is handled by `IVault.exitPool`.

        uint256[] memory amountsOut = StableMath._calcTokensOutGivenExactBptIn(
            balancesWithoutBpt,
            bptAmountIn,
            // This process burns BPT, rendering the approximation returned by `_dropBPTItem` inaccurate,
            // so we use the real method here
            _getVirtualSupply(balances[_bptIndex])
        );

        return (bptAmountIn, _addBptItem(amountsOut, 0));
    }

    // Scaling factors

    function getScalingFactor(IERC20 token) external view returns (uint256) {
        return _scalingFactor(token);
    }

    /**
     * @dev Overrides scaling factor getter to introduce the tokens' rates.
     */
    function _scalingFactors() internal view virtual override returns (uint256[] memory scalingFactors) {
        // There is no need to check the arrays length since both are based on `_getTotalTokens`
        uint256 totalTokens = _getTotalTokens();
        scalingFactors = super._scalingFactors();

        // Given there is no generic direction for this rounding, it follows the same strategy as the BasePool.
        // prettier-ignore
        {
            if (totalTokens > 0) { scalingFactors[0] = scalingFactors[0].mulDown(getTokenRate(_token0)); }
            if (totalTokens > 1) { scalingFactors[1] = scalingFactors[1].mulDown(getTokenRate(_token1)); }
            if (totalTokens > 2) { scalingFactors[2] = scalingFactors[2].mulDown(getTokenRate(_token2)); }
            if (totalTokens > 3) { scalingFactors[3] = scalingFactors[3].mulDown(getTokenRate(_token3)); }
            if (totalTokens > 4) { scalingFactors[4] = scalingFactors[4].mulDown(getTokenRate(_token4)); }
        }
    }

    /**
     * @dev Overrides scaling factor getter to introduce the token's rate.
     */
    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        // Given there is no generic direction for this rounding, it follows the same strategy as the BasePool.
        uint256 baseScalingFactor = super._scalingFactor(token);
        return baseScalingFactor.mulDown(getTokenRate(token));
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
            if (totalTokens > 0) { providers[0] = _rateProvider0; } else { return providers; }
            if (totalTokens > 1) { providers[1] = _rateProvider1; } else { return providers; }
            if (totalTokens > 2) { providers[2] = _rateProvider2; } else { return providers; }
            if (totalTokens > 3) { providers[3] = _rateProvider3; } else { return providers; }
            if (totalTokens > 4) { providers[4] = _rateProvider4; } else { return providers; }
        }
    }

    function _getRateProvider(IERC20 token) internal view returns (IRateProvider) {
        // prettier-ignore
        if (token == _token0) { return _rateProvider0; }
        else if (token == _token1) { return _rateProvider1; }
        else if (token == _token2) { return _rateProvider2; }
        else if (token == _token3) { return _rateProvider3; }
        else if (token == _token4) { return _rateProvider4; }
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
    function updateTokenRateCache(IERC20 token) external {
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
            if (totalTokens > 0) { _cacheTokenRateIfNecessary(_token0); } else { return; }
            if (totalTokens > 1) { _cacheTokenRateIfNecessary(_token1); } else { return; }
            if (totalTokens > 2) { _cacheTokenRateIfNecessary(_token2); } else { return; }
            if (totalTokens > 3) { _cacheTokenRateIfNecessary(_token3); } else { return; }
            if (totalTokens > 4) { _cacheTokenRateIfNecessary(_token4); } else { return; }
        }
    }

    /**
     * @dev Caches the rate for a token if necessary. It ignores the call if there is no provider set.
     */
    function _cacheTokenRateIfNecessary(IERC20 token) internal {
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

    function getCachedProtocolSwapFeePercentage() public view returns (uint256) {
        return _cachedProtocolSwapFeePercentage;
    }

    function updateCachedProtocolSwapFeePercentage() external {
        _updateCachedProtocolSwapFeePercentage(getVault());
    }

    function _updateCachedProtocolSwapFeePercentage(IVault vault) private {
        uint256 newPercentage = vault.getProtocolFeesCollector().getSwapFeePercentage();
        _cachedProtocolSwapFeePercentage = newPercentage;

        emit CachedProtocolSwapFeePercentageUpdated(newPercentage);
    }

    /**
     * @dev Overrides only owner action to allow setting the cache duration for the token rates
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view virtual override returns (bool) {
        return (actionId == getActionId(this.setTokenRateCacheDuration.selector)) || super._isOwnerOnlyAction(actionId);
    }

    function _skipBptIndex(uint256 index) internal view returns (uint256) {
        return index < _bptIndex ? index : index.sub(1);
    }

    function _dropBptItem(uint256[] memory amounts)
        internal
        view
        returns (uint256 virtualSupply, uint256[] memory amountsWithoutBpt)
    {
        // The initial amount of BPT pre-minted is _MAX_TOKEN_BALANCE and it goes entirely to the pool balance in the
        // vault. So the virtualSupply (the actual supply in circulation) is defined as:
        // virtualSupply = totalSupply() - (_balances[_bptIndex] - _dueProtocolFeeBptAmount)
        //
        // However, since this Pool never mints or burns BPT outside of the initial supply (except in the event of an
        // emergency pause), we can simply use `_MAX_TOKEN_BALANCE` instead of `totalSupply()` and save
        // gas.
        virtualSupply = _MAX_TOKEN_BALANCE - amounts[_bptIndex] + _dueProtocolFeeBptAmount;

        amountsWithoutBpt = new uint256[](amounts.length - 1);
        for (uint256 i = 0; i < amountsWithoutBpt.length; i++) {
            amountsWithoutBpt[i] = amounts[i < _bptIndex ? i : i + 1];
        }
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

    function _getVirtualSupply(uint256 bptBalance) internal view returns (uint256) {
        return totalSupply().sub(bptBalance).add(_dueProtocolFeeBptAmount);
    }

    /**
     * @dev This function returns the appreciation of one BPT relative to the
     * underlying tokens. This starts at 1 when the pool is created and grows over time.
     * Because of preminted BPT, it uses `getVirtualSupply` instead of `totalSupply`.
     */
    function getRate() public view override returns (uint256) {
        (, uint256[] memory balancesIncludingBpt, ) = getVault().getPoolTokens(getPoolId());
        _upscaleArray(balancesIncludingBpt, _scalingFactors());

        (uint256 virtualSupply, uint256[] memory balances) = _dropBptItem(balancesIncludingBpt);

        (uint256 currentAmp, ) = _getAmplificationParameter();

        return StableMath._getRate(balances, currentAmp, virtualSupply);
    }
}
