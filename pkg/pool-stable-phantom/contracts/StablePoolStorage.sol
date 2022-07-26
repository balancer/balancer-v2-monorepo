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
import "hardhat/console.sol";

abstract contract StablePoolStorage is BasePool {
    using FixedPoint for uint256;

    // This minimum refers not to the total tokens, but rather to the non-BPT tokens. The minimum value for _totalTokens
    // is therefore _MIN_TOKENS + 1.
    uint256 private constant _MIN_TOKENS = 2;

    // The Pool will register n+1 tokens, where n are the actual tokens in the Pool, and the other one is the BPT
    // itself.
    uint256 private immutable _totalTokens;

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

    IRateProvider internal immutable _rateProvider0;
    IRateProvider internal immutable _rateProvider1;
    IRateProvider internal immutable _rateProvider2;
    IRateProvider internal immutable _rateProvider3;
    IRateProvider internal immutable _rateProvider4;
    IRateProvider internal immutable _rateProvider5;

    // Set true if the corresponding token should have its yield exempted from protocol fees.
    // For example, the BPT of another PhantomStable Pool containing yield tokens.
    // The flag will always be false for the BPT token.
    bool internal immutable _exemptFromYieldProtocolFeeToken0;
    bool internal immutable _exemptFromYieldProtocolFeeToken1;
    bool internal immutable _exemptFromYieldProtocolFeeToken2;
    bool internal immutable _exemptFromYieldProtocolFeeToken3;
    bool internal immutable _exemptFromYieldProtocolFeeToken4;
    bool internal immutable _exemptFromYieldProtocolFeeToken5;

    constructor(
        IERC20[] memory registeredTokens,
        IRateProvider[] memory tokenRateProviders,
        bool[] memory exemptFromYieldProtocolFeeFlags
    ) {
        // BasePool checks that the Pool has at least two tokens, but since one of them is the BPT (this contract), we
        // need to check ourselves that there are at least creator-supplied tokens (i.e. the minimum number of total
        // tokens for this contract is actually three, including the BPT).
        uint256 totalTokens = registeredTokens.length;
        _require(totalTokens > _MIN_TOKENS, Errors.MIN_TOKENS);

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

        // The Vault keeps track of all Pool tokens in a specific order: we need to know what the index of BPT is in
        // this ordering to be able to identify it when balances arrays are received. Since the tokens array is sorted,
        // we need to find the correct BPT index in the array returned by `_insertSorted()`.
        // See `IVault.getPoolTokens()` for more information regarding token ordering.
        uint256 bptIndex;
        for (
            bptIndex = registeredTokens.length - 1;
            bptIndex > 0 && registeredTokens[bptIndex] > IERC20(this);
            bptIndex--
        ) {
            // solhint-disable-previous-line no-empty-blocks
        }
        _bptIndex = bptIndex;

        // The rate providers are stored as immutable state variables, and for simplicity when accessing those we'll
        // reference them by token index in the full base tokens plus BPT set (i.e. the tokens the Pool registers). Due
        // to immutable variables requiring an explicit assignment instead of defaulting to an empty value, it is
        // simpler to create a new memory array with the values we want to assign to the immutable state variables.
        IRateProvider[] memory rateProviders = new IRateProvider[](registeredTokens.length);
        // Do the same with exemptFromYieldProtocolFeeFlags
        bool[] memory exemptFromYieldFlags = new bool[](registeredTokens.length);

        for (uint256 i = 0; i < registeredTokens.length; ++i) {
            if (i < bptIndex) {
                rateProviders[i] = tokenRateProviders[i];
                exemptFromYieldFlags[i] = exemptFromYieldProtocolFeeFlags[i];
            } else if (i != bptIndex) {
                rateProviders[i] = tokenRateProviders[i - 1];
                exemptFromYieldFlags[i] = exemptFromYieldProtocolFeeFlags[i - 1];
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

    // Convert from an index into an array including BPT (the Vault's registered token list), to an index
    // into an array excluding BPT (usually from user input, such as amountsIn/Out).
    // `index` must not be the BPT token index itself.
    function _skipBptIndex(uint256 index) internal view returns (uint256) {
        // Currently this is never called with an index passed in from user input, so this check
        // should not be necessary. Included for completion (and future proofing).
        _require(index != getBptIndex(), Errors.OUT_OF_BOUNDS);

        return index < getBptIndex() ? index : index.sub(1);
    }

    // Convert from an index into an array excluding BPT (usually from user input, such as amountsIn/Out),
    // to an index into an array excluding BPT (the Vault's registered token list).
    // `index` must not be the BPT token index itself, if it is the last element, and the result must be
    // in the range of registered tokens.
    function _addBptIndex(uint256 index) internal view returns (uint256 indexWithBpt) {
        // This can be called from an index passed in from user input.
        indexWithBpt = index < getBptIndex() ? index : index.add(1);

        _require(indexWithBpt < _totalTokens && indexWithBpt != getBptIndex(), Errors.OUT_OF_BOUNDS);
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

    function _tokenScalingFactor(IERC20 token) internal view returns (uint256 scalingFactor) {
        // prettier-ignore
        if (token == _getToken0()) { scalingFactor = _getScalingFactor0(); }
        else if (token == _getToken1()) { scalingFactor = _getScalingFactor1(); }
        else if (token == _getToken2()) { scalingFactor = _getScalingFactor2(); }
        else if (token == _getToken3()) { scalingFactor = _getScalingFactor3(); }
        else if (token == _getToken4()) { scalingFactor = _getScalingFactor4(); }
        else if (token == _getToken5()) { scalingFactor = _getScalingFactor5(); }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    /**
     * @dev Returns the rate providers configured for each token (in the same order as registered).
     */
    function getRateProviders() external view returns (IRateProvider[] memory providers) {
        uint256 totalTokens = _getTotalTokens();
        providers = new IRateProvider[](totalTokens);

        // prettier-ignore
        {
            providers[0] = _getRateProvider0();
            providers[1] = _getRateProvider1();
            providers[2] = _getRateProvider2();
            if (totalTokens > 3) { providers[3] = _getRateProvider3(); } else { return providers; }
            if (totalTokens > 4) { providers[4] = _getRateProvider4(); } else { return providers; }
            if (totalTokens > 5) { providers[5] = _getRateProvider5(); } else { return providers; }
        }
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

    /**
     * @dev Returns whether the token is exempt from protocol fees on the yield.
     * If the BPT token is passed in (which doesn't make much sense, but shouldn't fail,
     * since it is a valid pool token), the corresponding flag will be false.
     */
    function isTokenExemptFromYieldProtocolFee(IERC20 token) external view returns (bool) {
        if (token == _getToken0()) return _exemptFromYieldProtocolFeeToken0;
        if (token == _getToken1()) return _exemptFromYieldProtocolFeeToken1;
        if (token == _getToken2()) return _exemptFromYieldProtocolFeeToken2;
        if (token == _getToken3()) return _exemptFromYieldProtocolFeeToken3;
        if (token == _getToken4()) return _exemptFromYieldProtocolFeeToken4;
        if (token == _getToken5()) return _exemptFromYieldProtocolFeeToken5;
        else {
            _revert(Errors.INVALID_TOKEN);
        }
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
}
