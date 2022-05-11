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
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";

import "@balancer-labs/v2-pool-stable/contracts/BaseStablePool.sol";
import "@balancer-labs/v2-pool-utils/contracts/rates/PriceRateCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/ProtocolFeeCache.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";

import "@balancer-labs/v2-pool-utils/contracts/rates/PriceRateCache.sol";
import "@balancer-labs/v2-pool-utils/contracts/ProtocolFeeCache.sol";

import "@balancer-labs/v2-pool-stable/contracts/StablePool.sol";

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
contract StablePhantomPool is BaseStablePool, ProtocolFeeCache {
    using FixedPoint for uint256;
    using PriceRateCache for bytes32;
    using StablePhantomPoolUserData for bytes;

    uint256 private constant _MIN_TOKENS = 2;
    uint256 private constant _MAX_TOKEN_BALANCE = 2**(112) - 1;

    uint256 private immutable _bptIndex;

    // Since this Pool is not joined or exited via the regular onJoinPool and onExitPool hooks, it lacks a way to
    // continuously pay due protocol fees. Instead, it keeps track of those internally.
    // Due protocol fees are expressed in BPT, which leads to reduced gas costs when compared to tracking due fees for
    // each Pool token. This means that some of the BPT deposited in the Vault for the Pool is part of the 'virtual'
    // supply, as it belongs to the protocol.
    uint256 private _dueProtocolFeeBptAmount;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    IERC20 internal immutable _token2;
    IERC20 internal immutable _token3;
    IERC20 internal immutable _token4;

    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;
    uint256 internal immutable _scalingFactor2;
    uint256 internal immutable _scalingFactor3;
    uint256 internal immutable _scalingFactor4;

    IRateProvider internal immutable _rateProvider0;
    IRateProvider internal immutable _rateProvider1;
    IRateProvider internal immutable _rateProvider2;
    IRateProvider internal immutable _rateProvider3;
    IRateProvider internal immutable _rateProvider4;

    event DueProtocolFeeIncreased(uint256 bptAmount);

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
        BaseStablePool(
            params.vault,
            params.name,
            params.symbol,
            _insertSorted(params.tokens, IERC20(this)),
            _insertBptRateProvider(params.tokens, IERC20(this), params.rateProviders),
            _insertBptDuration(params.tokens, IERC20(this), params.tokenRateCacheDurations),
            params.amplificationParameter,
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
        uint256 totalLength = params.tokens.length + 1;

        IRateProvider[] memory adjustedRateProviders = new IRateProvider[](totalLength);
        IERC20[] memory adjustedTokens = new IERC20[](totalLength);

        for (uint256 i = 0; i < adjustedRateProviders.length; ++i) {
            if (i < bptIndex) {
                adjustedRateProviders[i] = params.rateProviders[i];
                adjustedTokens[i] = params.tokens[i];
            } else if (i == bptIndex) {
                adjustedRateProviders[i] = IRateProvider(0);
                adjustedTokens[i] = IERC20(this);
            } else {
                adjustedRateProviders[i] = params.rateProviders[i - 1];
                adjustedTokens[i] = params.tokens[i - 1];
            }
        }

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        // There have to be at least three tokens (2 + BPT)
        _rateProvider0 = adjustedRateProviders[0];
        _rateProvider1 = adjustedRateProviders[1];
        _rateProvider2 = adjustedRateProviders[2];
        _rateProvider3 = (totalLength > 3) ? adjustedRateProviders[3] : IRateProvider(0);
        _rateProvider4 = (totalLength > 4) ? adjustedRateProviders[4] : IRateProvider(0);

        _token0 = adjustedTokens[0];
        _token1 = adjustedTokens[1];
        _token2 = adjustedTokens[2];
        _token3 = (totalLength > 3) ? adjustedTokens[3] : IERC20(0);
        _token4 = (totalLength > 4) ? adjustedTokens[4] : IERC20(0);

        _scalingFactor0 = _computeScalingFactor(adjustedTokens[0]);
        _scalingFactor1 = _computeScalingFactor(adjustedTokens[1]);
        _scalingFactor2 = _computeScalingFactor(adjustedTokens[2]);
        _scalingFactor3 = (totalLength > 3) ? _computeScalingFactor(adjustedTokens[3]) : FixedPoint.ONE;
        _scalingFactor4 = (totalLength > 4) ? _computeScalingFactor(adjustedTokens[4]) : FixedPoint.ONE;
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
        _cachePriceRatesIfNecessary();

        uint256 protocolSwapFeePercentage = getProtocolSwapFeePercentageCache();

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
        _cachePriceRatesIfNecessary();

        uint256 protocolSwapFeePercentage = getProtocolSwapFeePercentageCache();

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
        StablePhantomPoolUserData.JoinKindPhantom kind = userData.joinKind();
        _require(kind == StablePhantomPoolUserData.JoinKindPhantom.INIT, Errors.UNINITIALIZED);

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
        StablePhantomPoolUserData.JoinKindPhantom kind = userData.joinKind();

        if (kind == StablePhantomPoolUserData.JoinKindPhantom.COLLECT_PROTOCOL_FEES) {
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
        StablePhantomPoolUserData.ExitKindPhantom kind = userData.exitKind();

        // Exits typically revert, except for the proportional exit when the emergency pause mechanism has been
        // triggered. This allows for a simple and safe way to exit the Pool.
        if (kind == StablePhantomPoolUserData.ExitKindPhantom.EXACT_BPT_IN_FOR_TOKENS_OUT) {
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

    function _getScalingFactor0() private view returns (uint256) {
        return _scalingFactor0;
    }

    function _getScalingFactor1() private view returns (uint256) {
        return _scalingFactor1;
    }

    function _getScalingFactor2() private view returns (uint256) {
        return _scalingFactor2;
    }

    function _getScalingFactor3() private view returns (uint256) {
        return _scalingFactor3;
    }

    function _getScalingFactor4() private view returns (uint256) {
        return _scalingFactor4;
    }

    /**
     * @dev Overrides scaling factor getter to introduce the tokens' rates.
     */
    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        // There is no need to check the arrays length since both are based on `_getTotalTokens`
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory scalingFactors = new uint256[](totalTokens);

        // Given there is no generic direction for this rounding, it follows the same strategy as the BasePool.
        // prettier-ignore
        {
            scalingFactors[0] = _getScalingFactor0().mulDown(getTokenRate(_token0));
            scalingFactors[1] = _getScalingFactor1().mulDown(getTokenRate(_token1));
            scalingFactors[2] = _getScalingFactor2().mulDown(getTokenRate(_token2));
            if (totalTokens > 3) { scalingFactors[3] = _getScalingFactor3().mulDown(getTokenRate(_token3)); } else {
                return scalingFactors;
            }
            if (totalTokens > 4) { scalingFactors[4] = _getScalingFactor4().mulDown(getTokenRate(_token4)); } else {
                return scalingFactors;
            }

            return scalingFactors;
        }
    }

    /**
     * @dev Overrides scaling factor getter to introduce the token's rate.
     */
    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        // Given there is no generic direction for this rounding, it follows the same strategy as the BasePool.

        // prettier-ignore
        {
            uint256 rate = getTokenRate(token);

            if (_isToken0(token)) { return _getScalingFactor0().mulDown(rate); }
            if (_isToken1(token)) { return _getScalingFactor1().mulDown(rate); }
            if (_isToken2(token)) { return _getScalingFactor2().mulDown(rate); }
            if (_isToken3(token)) { return _getScalingFactor3().mulDown(rate); }
            if (_isToken4(token)) { return _getScalingFactor4().mulDown(rate); }
        }

        _revert(Errors.INVALID_TOKEN);
    }

    // Token rates

    /**
     * @dev Returns the rate providers configured for each token (in the same order as registered).
     */
    function getRateProviders() external view virtual override returns (IRateProvider[] memory) {
        uint256 totalTokens = _getTotalTokens();
        IRateProvider[] memory providers = new IRateProvider[](totalTokens);

        // prettier-ignore
        {
            providers[0] = _getRateProvider0();
            providers[1] = _getRateProvider1();
            providers[2] = _getRateProvider2();
            if (totalTokens > 3) { providers[3] = _getRateProvider3(); } else { return providers; }
            if (totalTokens > 4) { providers[4] = _getRateProvider4(); } else { return providers; }
        }

        return providers;
    }

    function _getRateProvider(IERC20 token) internal view returns (IRateProvider) {
        // prettier-ignore
        if (_isToken0(token)) { return _getRateProvider0(); }
        else if (_isToken1(token)) { return _getRateProvider1(); }
        else if (_isToken2(token)) { return _getRateProvider2(); }
        else if (_isToken3(token)) { return _getRateProvider3(); }
        else if (_isToken4(token)) { return _getRateProvider4(); }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _getRateProvider(uint256 index) internal view virtual override returns (IRateProvider) {
        if (index == 0) {
            return _getRateProvider0();
        } else if (index == 1) {
            return _getRateProvider1();
        } else if (index == 2) {
            return _getRateProvider2();
        } else if (index == 3) {
            return _getRateProvider3();
        } else if (index == 4) {
            return _getRateProvider4();
        }

        _revert(Errors.OUT_OF_BOUNDS);
    }

    /**
     * @dev Returns the cached value for token's rate. Ensures the token has a provider.
     */
    function getPriceRateCache(IERC20 token)
        external
        view
        virtual
        override
        returns (
            uint256 rate,
            uint256 duration,
            uint256 expires
        )
    {
        _require(_getRateProvider(token) != IRateProvider(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);

        return _getPriceRateCache(_getPriceRateCache(token));
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

    // @dev Needed to insert (0) duration for BPT token into the raw list of durations:
    // which only considers the regular tokens.
    function _insertBptDuration(
        IERC20[] memory tokens,
        IERC20 token,
        uint256[] memory rawDurations
    ) private pure returns (uint256[] memory durations) {
        InputHelpers.ensureInputLengthMatch(tokens.length, rawDurations.length);

        durations = new uint256[](tokens.length + 1);

        uint256 i;
        for (i = tokens.length; i > 0 && tokens[i - 1] > token; i--) durations[i] = rawDurations[i - 1];
        for (uint256 j = 0; j < i; j++) durations[j] = rawDurations[j];
    }

    // @dev Needed to insert (ZERO_ADDRESS) rate provider for the BPT token into the raw list of providers:
    // which only considers the regular tokens.
    function _insertBptRateProvider(
        IERC20[] memory tokens,
        IERC20 token,
        IRateProvider[] memory rawProviders
    ) private pure returns (IRateProvider[] memory rateProviders) {
        InputHelpers.ensureInputLengthMatch(tokens.length, rawProviders.length);

        rateProviders = new IRateProvider[](tokens.length + 1);

        uint256 i;
        for (i = tokens.length; i > 0 && tokens[i - 1] > token; i--) rateProviders[i] = rawProviders[i - 1];
        for (uint256 j = 0; j < i; j++) rateProviders[j] = rawProviders[j];
    }

    function _getRateProvider0() private view returns (IRateProvider) {
        return _rateProvider0;
    }

    function _getRateProvider1() private view returns (IRateProvider) {
        return _rateProvider1;
    }

    function _getRateProvider2() private view returns (IRateProvider) {
        return _rateProvider2;
    }

    function _getRateProvider3() private view returns (IRateProvider) {
        return _rateProvider3;
    }

    function _getRateProvider4() private view returns (IRateProvider) {
        return _rateProvider4;
    }

    function _isToken0(IERC20 token) internal view virtual override returns (bool) {
        return _token0 == token;
    }

    function _isToken1(IERC20 token) private view returns (bool) {
        return _token1 == token;
    }

    function _isToken2(IERC20 token) private view returns (bool) {
        return _token2 == token;
    }

    function _isToken3(IERC20 token) private view returns (bool) {
        return _token3 == token;
    }

    function _isToken4(IERC20 token) private view returns (bool) {
        return _token4 == token;
    }
}
