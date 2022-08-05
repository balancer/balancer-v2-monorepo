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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";

import "./StableMath.sol";

abstract contract StablePoolStorage is BasePool {
    using FixedPoint for uint256;

    struct StorageParams {
        IERC20[] registeredTokens;
        IRateProvider[] tokenRateProviders;
        bool[] exemptFromYieldProtocolFeeFlags;
    }

    // This minimum refers not to the total tokens, but rather to the non-BPT tokens. The minimum value for _totalTokens
    // is therefore _MIN_TOKENS + 1.
    uint256 private constant _MIN_TOKENS = 2;

    // The Pool will register n+1 tokens, where n are the actual tokens in the Pool, and the other one is the BPT
    // itself.
    uint256 private immutable _totalTokens;

    // The index of BPT in the tokens and balances arrays, i.e. its index when calling IVault.registerTokens().
    uint256 private immutable _bptIndex;

    // These are the registered tokens: one of them will be the BPT.
    IERC20 private immutable _token0;
    IERC20 private immutable _token1;
    IERC20 private immutable _token2;
    IERC20 private immutable _token3;
    IERC20 private immutable _token4;
    IERC20 private immutable _token5;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.

    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;
    uint256 internal immutable _scalingFactor2;
    uint256 internal immutable _scalingFactor3;
    uint256 internal immutable _scalingFactor4;
    uint256 internal immutable _scalingFactor5;

    // Rate Providers accommodate tokens with a known price ratio, such as Compound's cTokens.

    IRateProvider private immutable _rateProvider0;
    IRateProvider private immutable _rateProvider1;
    IRateProvider private immutable _rateProvider2;
    IRateProvider private immutable _rateProvider3;
    IRateProvider private immutable _rateProvider4;
    IRateProvider private immutable _rateProvider5;

    // This is a bitmap, where the LSB corresponds to _token0, bit 1 to _token1, etc.
    // Set each bit true if the corresponding token should have its yield exempted from protocol fees.
    // For example, the BPT of another PhantomStable Pool containing yield tokens.
    // The flag will always be false for the BPT token.
    uint256 private immutable _exemptFromYieldProtocolFeeTokens;

    constructor(StorageParams memory params) {
        // BasePool checks that the Pool has at least two tokens, but since one of them is the BPT (this contract), we
        // need to check ourselves that there are at least creator-supplied tokens (i.e. the minimum number of total
        // tokens for this contract is actually three, including the BPT).
        uint256 totalTokens = params.registeredTokens.length;
        _require(totalTokens > _MIN_TOKENS, Errors.MIN_TOKENS);
        InputHelpers.ensureInputLengthMatch(
            totalTokens - 1,
            params.tokenRateProviders.length,
            params.exemptFromYieldProtocolFeeFlags.length
        );

        _totalTokens = totalTokens;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _token0 = params.registeredTokens[0];
        _token1 = params.registeredTokens[1];
        _token2 = params.registeredTokens[2];
        _token3 = totalTokens > 3 ? params.registeredTokens[3] : IERC20(0);
        _token4 = totalTokens > 4 ? params.registeredTokens[4] : IERC20(0);
        _token5 = totalTokens > 5 ? params.registeredTokens[5] : IERC20(0);

        _scalingFactor0 = _computeScalingFactor(params.registeredTokens[0]);
        _scalingFactor1 = _computeScalingFactor(params.registeredTokens[1]);
        _scalingFactor2 = _computeScalingFactor(params.registeredTokens[2]);
        _scalingFactor3 = totalTokens > 3 ? _computeScalingFactor(params.registeredTokens[3]) : 0;
        _scalingFactor4 = totalTokens > 4 ? _computeScalingFactor(params.registeredTokens[4]) : 0;
        _scalingFactor5 = totalTokens > 5 ? _computeScalingFactor(params.registeredTokens[5]) : 0;

        // The Vault keeps track of all Pool tokens in a specific order: we need to know what the index of BPT is in
        // this ordering to be able to identify it when balances arrays are received. Since the tokens array is sorted,
        // we need to find the correct BPT index in the array returned by `_insertSorted()`.
        // See `IVault.getPoolTokens()` for more information regarding token ordering.
        uint256 bptIndex;
        for (
            bptIndex = params.registeredTokens.length - 1;
            bptIndex > 0 && params.registeredTokens[bptIndex] > IERC20(this);
            bptIndex--
        ) {
            // solhint-disable-previous-line no-empty-blocks
        }
        _bptIndex = bptIndex;

        // The rate providers are stored as immutable state variables, and for simplicity when accessing those we'll
        // reference them by token index in the full base tokens plus BPT set (i.e. the tokens the Pool registers). Due
        // to immutable variables requiring an explicit assignment instead of defaulting to an empty value, it is
        // simpler to create a new memory array with the values we want to assign to the immutable state variables.
        IRateProvider[] memory rateProviders = new IRateProvider[](params.registeredTokens.length);

        // Do the same with exemptFromYieldProtocolFeeFlags
        // The exemptFromYieldFlag should never be set on a token without a rate provider.
        // This would cause division by zero errors downstream.
        uint256 exemptFlagBitmap;

        for (uint256 i = 0; i < params.registeredTokens.length; ++i) {
            if (i < bptIndex) {
                rateProviders[i] = params.tokenRateProviders[i];
                if (params.exemptFromYieldProtocolFeeFlags[i]) {
                    _require(rateProviders[i] != IRateProvider(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
                    exemptFlagBitmap += 1 << i;
                }
            } else if (i != bptIndex) {
                rateProviders[i] = params.tokenRateProviders[i - 1];
                if (params.exemptFromYieldProtocolFeeFlags[i - 1]) {
                    _require(rateProviders[i] != IRateProvider(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
                    exemptFlagBitmap += 1 << i;
                }
            }
        }

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _rateProvider0 = rateProviders[0];
        _rateProvider1 = rateProviders[1];
        _rateProvider2 = rateProviders[2];
        _rateProvider3 = (rateProviders.length > 3) ? rateProviders[3] : IRateProvider(0);
        _rateProvider4 = (rateProviders.length > 4) ? rateProviders[4] : IRateProvider(0);
        _rateProvider5 = (rateProviders.length > 5) ? rateProviders[5] : IRateProvider(0);

        _exemptFromYieldProtocolFeeTokens = exemptFlagBitmap;
    }

    // Tokens

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _totalTokens;
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        // The BPT will be one of the Pool tokens, but it is unaffected by the Stable 5 token limit.
        return StableMath._MAX_STABLE_TOKENS + 1;
    }

    function getBptIndex() public view returns (uint256) {
        return _bptIndex;
    }

    function _getToken0() internal view returns (IERC20) {
        return _token0;
    }

    function _getToken1() internal view returns (IERC20) {
        return _token1;
    }

    function _getToken2() internal view returns (IERC20) {
        return _token2;
    }

    function _getToken3() internal view returns (IERC20) {
        return _token3;
    }

    function _getToken4() internal view returns (IERC20) {
        return _token4;
    }

    function _getToken5() internal view returns (IERC20) {
        return _token5;
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

    function _scalingFactor(IERC20) internal view virtual override returns (uint256) {
        // We never a single token's scaling factor: we aways process the entire array at once. Therefore, we don't
        // bother providing an implementation for this.
        _revert(Errors.UNIMPLEMENTED);
    }

    // Index helpers

    // Convert from an index into an array including BPT (the Vault's registered token list), to an index
    // into an array excluding BPT (usually from user input, such as amountsIn/Out).
    // `index` must not be the BPT token index itself.
    function _skipBptIndex(uint256 index) internal view returns (uint256) {
        // Currently this is never called with an index passed in from user input, so this check
        // should not be necessary. Included for completion (and future proofing).
        _require(index != getBptIndex(), Errors.OUT_OF_BOUNDS);

        return index < getBptIndex() ? index : index.sub(1);
    }

    /**
     * @dev Remove the item at `_bptIndex` from an arbitrary array (e.g., amountsIn).
     */
    function _dropBptItem(uint256[] memory amounts) internal view returns (uint256[] memory) {
        uint256[] memory amountsWithoutBpt = new uint256[](amounts.length - 1);
        for (uint256 i = 0; i < amountsWithoutBpt.length; i++) {
            amountsWithoutBpt[i] = amounts[i < getBptIndex() ? i : i + 1];
        }

        return amountsWithoutBpt;
    }

    // Convert from an index into an array excluding BPT (usually from user input, such as amountsIn/Out),
    // to an index into an array excluding BPT (the Vault's registered token list).
    // `index` must not be the BPT token index itself, if it is the last element, and the result must be
    // in the range of registered tokens.
    function _addBptIndex(uint256 index) internal view returns (uint256 indexWithBpt) {
        // This can be called from an index passed in from user input.
        indexWithBpt = index < getBptIndex() ? index : index.add(1);

        // TODO: `indexWithBpt != getBptIndex()` follows from above line and so can be removed.
        _require(indexWithBpt < _totalTokens && indexWithBpt != getBptIndex(), Errors.OUT_OF_BOUNDS);
    }

    /**
     * @dev Take an array of arbitrary values the size of the token set without BPT, and insert the given
     * bptAmount at the bptIndex location.
     *
     * The caller is responsible for ensuring the `amounts` input array is sized properly; this function
     * performs no checks.
     */
    function _addBptItem(uint256[] memory amounts, uint256 bptAmount)
        internal
        view
        returns (uint256[] memory amountsWithBpt)
    {
        amountsWithBpt = new uint256[](amounts.length + 1);
        for (uint256 i = 0; i < amountsWithBpt.length; i++) {
            amountsWithBpt[i] = i == getBptIndex() ? bptAmount : amounts[i < getBptIndex() ? i : i - 1];
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

    // Rate Providers

    function _getRateProvider0() internal view returns (IRateProvider) {
        return _rateProvider0;
    }

    function _getRateProvider1() internal view returns (IRateProvider) {
        return _rateProvider1;
    }

    function _getRateProvider2() internal view returns (IRateProvider) {
        return _rateProvider2;
    }

    function _getRateProvider3() internal view returns (IRateProvider) {
        return _rateProvider3;
    }

    function _getRateProvider4() internal view returns (IRateProvider) {
        return _rateProvider4;
    }

    function _getRateProvider5() internal view returns (IRateProvider) {
        return _rateProvider5;
    }

    /**
     * @dev Returns the rate providers configured for each token (in the same order as registered).
     */
    function getRateProviders() external view returns (IRateProvider[] memory providers) {
        uint256 totalTokens = _getTotalTokens();
        providers = new IRateProvider[](totalTokens);

        // The Pool will always have at least 3 tokens so we always load these three rate providers.
        providers[0] = _getRateProvider0();
        providers[1] = _getRateProvider1();
        providers[2] = _getRateProvider2();

        // Before we load the remaining rate providers we must check that the Pool contains enough tokens.
        if (totalTokens == 3) return providers;
        providers[3] = _getRateProvider3();

        if (totalTokens == 4) return providers;
        providers[4] = _getRateProvider4();

        if (totalTokens == 5) return providers;
        providers[5] = _getRateProvider5();
    }

    function _getRateProvider(IERC20 token) internal view returns (IRateProvider) {
        if (token == _getToken0()) return _getRateProvider0();
        if (token == _getToken1()) return _getRateProvider1();
        if (token == _getToken2()) return _getRateProvider2();
        if (token == _getToken3()) return _getRateProvider3();
        if (token == _getToken4()) return _getRateProvider4();
        if (token == _getToken5()) return _getRateProvider5();
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    // Exempt flags

    /**
     * @dev Returns whether the token is exempt from protocol fees on the yield.
     * If the BPT token is passed in (which doesn't make much sense, but shouldn't fail,
     * since it is a valid pool token), the corresponding flag will be false.
     *
     * These immutables are only accessed once, so we don't need individual getters.
     */
    function isTokenExemptFromYieldProtocolFee(IERC20 token) external view returns (bool) {
        if (token == _getToken0()) return _isTokenExemptFromYieldProtocolFee(0);
        if (token == _getToken1()) return _isTokenExemptFromYieldProtocolFee(1);
        if (token == _getToken2()) return _isTokenExemptFromYieldProtocolFee(2);
        if (token == _getToken3()) return _isTokenExemptFromYieldProtocolFee(3);
        if (token == _getToken4()) return _isTokenExemptFromYieldProtocolFee(4);
        if (token == _getToken5()) return _isTokenExemptFromYieldProtocolFee(5);
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    // This assumes the tokenIndex is valid. If it's not, it will just return false.
    function _isTokenExemptFromYieldProtocolFee(uint256 tokenIndex) internal view returns (bool) {
        return _exemptFromYieldProtocolFeeTokens & (1 << tokenIndex) > 0;
    }
}
