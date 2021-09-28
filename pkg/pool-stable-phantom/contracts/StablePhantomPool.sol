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

    // Token rate caches are used to avoid querying the price rate for a token every time we need to work with it.
    // Data is stored with the following structure:
    //
    // [   expires   | duration | price rate value ]
    // [   uint64    |  uint64  |      uint128     ]

    mapping(IERC20 => bytes32) private _tokenRateCaches;
    mapping(IERC20 => IRateProvider) private _rateProviders;

    event TokenRateCacheUpdated(IERC20 indexed token, uint256 rate);
    event TokenRateProviderSet(IERC20 indexed token, IRateProvider indexed provider, uint256 cacheDuration);

    enum JoinKindPhantom { INIT, COLLECT_PROTOCOL_FEES }

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
            _rateProviders[params.tokens[i]] = params.rateProviders[i];
            _updateTokenRateCache(params.tokens[i], params.rateProviders[i], params.tokenRateCacheDurations[i]);
            emit TokenRateProviderSet(params.tokens[i], params.rateProviders[i], params.tokenRateCacheDurations[i]);
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
    ) internal virtual override returns (uint256 amountOut) {
        _cacheTokenRatesIfNecessary();

        // Compute virtual BPT supply and token balances (sans BPT).
        (uint256 virtualSupply, uint256[] memory balances) = _dropBptItem(balancesIncludingBpt);

        if (request.tokenIn == IERC20(this)) {
            amountOut = _onSwapTokenGivenBptIn(request.amount, _skipBptIndex(indexOut), virtualSupply, balances);

            // For given in swaps, request.amount holds the amount in.
            _trackDueProtocolFeeByBpt(request.amount);
        } else if (request.tokenOut == IERC20(this)) {
            amountOut = _onSwapBptGivenTokenIn(request.amount, _skipBptIndex(indexIn), virtualSupply, balances);

            _trackDueProtocolFeeByBpt(amountOut);
        } else {
            // To compute accrued protocol fees in BPT, we measure the invariant before and after the swap, then compute
            // the equivalent BPT amount that accounts for that growth and finally extract the percentage that
            // corresponds to protocol fees.

            (uint256 amp, ) = _getAmplificationParameter();

            uint256 previousInvariant = StableMath._calculateInvariant(amp, balances, true);

            uint256 newIndexIn = _skipBptIndex(indexIn);
            uint256 newIndexOut = _skipBptIndex(indexOut);
            amountOut = super._onSwapGivenIn(request, balances, _skipBptIndex(indexIn), _skipBptIndex(indexOut));

            uint256 amountInWithFee = _addSwapFeeAmount(request.amount);
            balances[newIndexIn] = balances[newIndexIn].add(amountInWithFee);
            balances[newIndexOut] = balances[newIndexOut].sub(amountOut);

            _trackDueProtocolFeeByInvariantIncrement(previousInvariant, amp, balances, virtualSupply);
        }
    }

    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override returns (uint256 amountIn) {
        _cacheTokenRatesIfNecessary();

        // Compute virtual BPT supply and token balances (sans BPT).
        (uint256 virtualSupply, uint256[] memory balances) = _dropBptItem(balancesIncludingBpt);

        if (request.tokenIn == IERC20(this)) {
            amountIn = _onSwapBptGivenTokenOut(request.amount, _skipBptIndex(indexOut), virtualSupply, balances);

            _trackDueProtocolFeeByBpt(amountIn);
        } else if (request.tokenOut == IERC20(this)) {
            amountIn = _onSwapTokenGivenBptOut(request.amount, _skipBptIndex(indexIn), virtualSupply, balances);

            // For given out swaps, request.amount holds the amount out.
            _trackDueProtocolFeeByBpt(request.amount);
        } else {
            // To compute accrued protocol fees in BPT, we measure the invariant before and after the swap, then compute
            // the equivalent BPT amount that accounts for that growth and finally extract the percentage that
            // corresponds to protocol fees.

            (uint256 amp, ) = _getAmplificationParameter();

            uint256 previousInvariant = StableMath._calculateInvariant(amp, balances, true);

            uint256 newIndexIn = _skipBptIndex(indexIn);
            uint256 newIndexOut = _skipBptIndex(indexOut);
            amountIn = super._onSwapGivenOut(request, balances, newIndexIn, newIndexOut);

            uint256 amountInWithFee = _addSwapFeeAmount(amountIn);
            balances[newIndexIn] = balances[newIndexIn].add(amountInWithFee);
            balances[newIndexOut] = balances[newIndexOut].sub(request.amount);

            _trackDueProtocolFeeByInvariantIncrement(previousInvariant, amp, balances, virtualSupply);
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
        uint256 virtualSupply
    ) private {
        IProtocolFeesCollector collector = getVault().getProtocolFeesCollector();
        uint256 protocolSwapFeePercentage = collector.getSwapFeePercentage();

        // To convert the protocol swap fees to a BPT amount, we compute the invariant growth (which is due exclusively
        // to swap fees), extract the portion that corresponds to protocol swap fees, and then compute the equivalent
        // amout of BPT that would cause such an increase.

        if (protocolSwapFeePercentage > 0) {
            uint256 postSwapInvariant = StableMath._calculateInvariant(amp, postSwapBalances, true);
            uint256 invariantRatio = postSwapInvariant.divUp(previousInvariant);

            if (invariantRatio > FixedPoint.ONE) {
                // This condition should always be met outside of rounding errors (for non-zero swap fees).

                uint256 invariantRatioDueToProtocolFees = protocolSwapFeePercentage.mulDown(
                    invariantRatio.sub(FixedPoint.ONE)
                );

                uint256 protocolFeeAmount = invariantRatioDueToProtocolFees.mulDown(virtualSupply).divDown(
                    invariantRatioDueToProtocolFees.complement()
                );
                _dueProtocolFeeBptAmount = _dueProtocolFeeBptAmount.add(protocolFeeAmount);
            }
        }
    }

    /**
     * @dev Tracks newly charged protocol fees after a swap where `bptAmount` was either sent or received (i.e. a
     * single-token join or exit).
     */
    function _trackDueProtocolFeeByBpt(uint256 bptAmount) private {
        IProtocolFeesCollector collector = getVault().getProtocolFeesCollector();
        uint256 protocolSwapFeePercentage = collector.getSwapFeePercentage();

        uint256 feeAmount = _addSwapFeeAmount(bptAmount).sub(bptAmount);

        uint256 protocolFeeAmount = feeAmount.mulDown(protocolSwapFeePercentage);
        _dueProtocolFeeBptAmount = _dueProtocolFeeBptAmount.add(protocolFeeAmount);
    }

    /**
     * Since this Pool has preminted BPT which is stored in the Vault, it cannot be simply minted at construction.
     *
     * We take advantage of the fact that StablePools have an initialization step where BPT is minted to the first
     * account joining them, and perform both actions at once. By minting the entire BPT supply for the initial joiner
     * and then pulling all tokens except the joiner's due, we arrive at the desired state of the Pool holding all BPT
     * except the joiner's.
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

        // This Join grants no BPT nor takes any tokens from the sender.
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
        uint256[] memory,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory
    )
        internal
        pure
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        _revert(Errors.UNHANDLED_BY_PHANTOM_POOL);
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
            if (totalTokens > 0) { providers[0] = _rateProviders[_token0]; } else { return providers; }
            if (totalTokens > 1) { providers[1] = _rateProviders[_token1]; } else { return providers; }
            if (totalTokens > 2) { providers[2] = _rateProviders[_token2]; } else { return providers; }
            if (totalTokens > 3) { providers[3] = _rateProviders[_token3]; } else { return providers; }
            if (totalTokens > 4) { providers[4] = _rateProviders[_token4]; } else { return providers; }
        }
    }

    /**
     * @dev Returns the token rate for token. All token rates are fixed-point values with 18 decimals.
     * In case there is no rate provider for the provided token it returns 1e18.
     */
    function getTokenRate(IERC20 token) public view virtual returns (uint256) {
        bytes32 tokenRateCache = _tokenRateCaches[token];
        return tokenRateCache == bytes32(0) ? FixedPoint.ONE : tokenRateCache.getValue();
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
        rate = _tokenRateCaches[token].getValue();
        (duration, expires) = _tokenRateCaches[token].getTimestamps();
    }

    /**
     * @dev Sets a new duration for a token rate cache. It reverts if there was no rate provider set initially.
     * Note this function also updates the current cached value.
     * @param duration Number of seconds until the current rate of token rate is fetched again.
     */
    function setTokenRateCacheDuration(IERC20 token, uint256 duration) external authenticate {
        IRateProvider provider = _rateProviders[token];
        _require(address(provider) != address(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
        _updateTokenRateCache(token, provider, duration);
        emit TokenRateProviderSet(token, provider, duration);
    }

    /**
     * @dev Forces a rate cache hit for a token.
     * It will revert if the requested token does not have a rate provider associated.
     */
    function updateTokenRateCache(IERC20 token) external {
        IRateProvider provider = _rateProviders[token];
        _require(address(provider) != address(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
        uint256 duration = _tokenRateCaches[token].getDuration();
        _updateTokenRateCache(token, provider, duration);
    }

    /**
     * @dev Internal function to updates a token rate cache for a known provider and duration.
     * It trusts the given values, it does not perform any checks.
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
     * @dev Caches the rate for a token if necessary. It ignores the call if theres is no provider set.
     */
    function _cacheTokenRateIfNecessary(IERC20 token) internal {
        IRateProvider provider = _rateProviders[token];
        if (address(provider) != address(0)) {
            (uint256 duration, uint256 expires) = _tokenRateCaches[token].getTimestamps();
            if (block.timestamp > expires) {
                // solhint-disable-previous-line not-rely-on-time
                _updateTokenRateCache(token, provider, duration);
            }
        }
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

    function _dropBptItem(uint256[] memory _balances)
        internal
        view
        returns (uint256 virtualSupply, uint256[] memory balances)
    {
        virtualSupply = _MAX_TOKEN_BALANCE - _balances[_bptIndex] + _dueProtocolFeeBptAmount;

        balances = new uint256[](_balances.length - 1);
        for (uint256 i = 0; i < balances.length; i++) {
            balances[i] = _balances[i < _bptIndex ? i : i + 1];
        }
    }
}
