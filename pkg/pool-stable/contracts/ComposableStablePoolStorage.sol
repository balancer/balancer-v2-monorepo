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
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProviderPool.sol";

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";

import "./StableMath.sol";

abstract contract ComposableStablePoolStorage is BasePool, IRateProviderPool {
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    struct StorageParams {
        IERC20[] registeredTokens;
        IRateProvider[] tokenRateProviders;
        bool[] exemptFromYieldProtocolFeeFlags;
    }

    // This minimum refers not to the total tokens, but rather to the non-BPT tokens. The minimum value for _totalTokens
    // is therefore _MIN_NON_BPT_TOKENS + 1.
    uint256 private constant _MIN_NON_BPT_TOKENS = 2;

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

    IRateProvider internal immutable _rateProvider0;
    IRateProvider internal immutable _rateProvider1;
    IRateProvider internal immutable _rateProvider2;
    IRateProvider internal immutable _rateProvider3;
    IRateProvider internal immutable _rateProvider4;
    IRateProvider internal immutable _rateProvider5;

    // This is a bitmap which allows querying whether a token at a particular index:
    // - has a rate provider associated with it.
    // - is exempt from yield protocol fees.
    // This is required as the data stored in this bitmap is computed from values in immutable storage,
    // without this bitmap we would have to manually search through token by token to reach these values.
    // The data structure is as follows:
    //
    // [  unused  | rate provider flags | exemption flags ]
    // [ 244 bits |        6 bits       |     6 bits      ]
    bytes32 private immutable _rateProviderInfoBitmap;

    // We also keep two dedicated flags that indicate the special cases where none or all tokens are exempt, which allow
    // for some gas optimizations in these special scenarios.
    bool private immutable _noTokensExempt;
    bool private immutable _allTokensExempt;

    uint256 private constant _RATE_PROVIDER_FLAGS_OFFSET = 6;

    constructor(StorageParams memory params) {
        // BasePool checks that the Pool has at least two tokens, but since one of them is the BPT (this contract), we
        // need to check ourselves that there are at least creator-supplied tokens (i.e. the minimum number of total
        // tokens for this contract is actually three, including the BPT).
        uint256 totalTokens = params.registeredTokens.length;
        _require(totalTokens > _MIN_NON_BPT_TOKENS, Errors.MIN_TOKENS);
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

        bytes32 rateProviderInfoBitmap;

        bool anyExempt = false;
        bool anyNonExempt = false;

        // The exemptFromYieldFlag should never be set on a token without a rate provider.
        // This would cause division by zero errors downstream.
        for (uint256 i = 0; i < params.registeredTokens.length; ++i) {
            if (i < bptIndex) {
                rateProviders[i] = params.tokenRateProviders[i];
                // Store whether token has rate provider
                rateProviderInfoBitmap = rateProviderInfoBitmap.insertBool(
                    rateProviders[i] != IRateProvider(0),
                    _RATE_PROVIDER_FLAGS_OFFSET + i
                );
                // Store whether token is exempt from yield fees.
                if (params.exemptFromYieldProtocolFeeFlags[i]) {
                    _require(rateProviders[i] != IRateProvider(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
                    rateProviderInfoBitmap = rateProviderInfoBitmap.insertBool(true, i);

                    anyExempt = true;
                } else {
                    anyNonExempt = true;
                }
            } else if (i != bptIndex) {
                rateProviders[i] = params.tokenRateProviders[i - 1];
                // Store whether token has rate provider
                rateProviderInfoBitmap = rateProviderInfoBitmap.insertBool(
                    rateProviders[i] != IRateProvider(0),
                    _RATE_PROVIDER_FLAGS_OFFSET + i
                );
                // Store whether token is exempt from yield fees.
                if (params.exemptFromYieldProtocolFeeFlags[i - 1]) {
                    _require(rateProviders[i] != IRateProvider(0), Errors.TOKEN_DOES_NOT_HAVE_RATE_PROVIDER);
                    rateProviderInfoBitmap = rateProviderInfoBitmap.insertBool(true, i);

                    anyExempt = true;
                } else {
                    anyNonExempt = true;
                }
            }
        }

        _noTokensExempt = !anyExempt;
        _allTokensExempt = !anyNonExempt;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _rateProvider0 = rateProviders[0];
        _rateProvider1 = rateProviders[1];
        _rateProvider2 = rateProviders[2];
        _rateProvider3 = (rateProviders.length > 3) ? rateProviders[3] : IRateProvider(0);
        _rateProvider4 = (rateProviders.length > 4) ? rateProviders[4] : IRateProvider(0);
        _rateProvider5 = (rateProviders.length > 5) ? rateProviders[5] : IRateProvider(0);

        _rateProviderInfoBitmap = rateProviderInfoBitmap;
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

    function _getTokenIndex(IERC20 token) internal view returns (uint256) {
        if (token == _token0) return 0;
        if (token == _token1) return 1;
        if (token == _token2) return 2;
        if (token == _token3) return 3;
        if (token == _token4) return 4;
        if (token == _token5) return 5;

        _revert(Errors.INVALID_TOKEN);
    }

    function _scalingFactor(IERC20) internal view virtual override returns (uint256) {
        // We never use a single token's scaling factor by itself, we always process the entire array at once.
        // Therefore we don't bother providing an implementation for this.
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

    /**
     * @dev Same as `_dropBptItem`, except the virtual supply is also returned, and `balances` is assumed to be the
     * current Pool balances (including BPT).
     */
    function _dropBptItemFromBalances(uint256[] memory registeredBalances)
        internal
        view
        returns (uint256, uint256[] memory)
    {
        return (_getVirtualSupply(registeredBalances[getBptIndex()]), _dropBptItem(registeredBalances));
    }

    // Convert from an index into an array excluding BPT (usually from user input, such as amountsIn/Out),
    // to an index into an array including BPT (the Vault's registered token list).
    // `index` must not be the BPT token index itself, if it is the last element, and the result must be
    // in the range of registered tokens.
    function _addBptIndex(uint256 index) internal view returns (uint256 registeredIndex) {
        // This can be called from an index passed in from user input.
        registeredIndex = index < getBptIndex() ? index : index.add(1);

        // TODO: `indexWithBpt != getBptIndex()` follows from above line and so can be removed.
        _require(registeredIndex < _totalTokens && registeredIndex != getBptIndex(), Errors.OUT_OF_BOUNDS);
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
        returns (uint256[] memory registeredTokenAmounts)
    {
        registeredTokenAmounts = new uint256[](amounts.length + 1);
        for (uint256 i = 0; i < registeredTokenAmounts.length; i++) {
            registeredTokenAmounts[i] = i == getBptIndex() ? bptAmount : amounts[i < getBptIndex() ? i : i - 1];
        }
    }

    // Rate Providers

    function _getScalingFactor(uint256 index) internal view returns (uint256) {
        if (index == 0) return _scalingFactor0;
        if (index == 1) return _scalingFactor1;
        if (index == 2) return _scalingFactor2;
        if (index == 3) return _scalingFactor3;
        if (index == 4) return _scalingFactor4;
        if (index == 5) return _scalingFactor5;
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function getRateProviders() external view override returns (IRateProvider[] memory) {
        uint256 totalTokens = _getTotalTokens();
        IRateProvider[] memory providers = new IRateProvider[](totalTokens);

        for (uint256 i = 0; i < totalTokens; ++i) {
            providers[i] = _getRateProvider(i);
        }

        return providers;
    }

    function _getRateProvider(uint256 index) internal view returns (IRateProvider) {
        if (index == 0) return _rateProvider0;
        if (index == 1) return _rateProvider1;
        if (index == 2) return _rateProvider2;
        if (index == 3) return _rateProvider3;
        if (index == 4) return _rateProvider4;
        if (index == 5) return _rateProvider5;
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    /**
     * @notice Return true if the token at this index has a rate provider
     */
    function _hasRateProvider(uint256 tokenIndex) internal view returns (bool) {
        return _rateProviderInfoBitmap.decodeBool(_RATE_PROVIDER_FLAGS_OFFSET + tokenIndex);
    }

    /**
     * @notice Return true if all tokens are exempt from yield fees.
     */
    function _areAllTokensExempt() internal view returns (bool) {
        return _allTokensExempt;
    }

    /**
     * @notice Return true if no tokens are exempt from yield fees.
     */
    function _areNoTokensExempt() internal view returns (bool) {
        return _noTokensExempt;
    }

    // Exempt flags

    /**
     * @dev Returns whether the token is exempt from protocol fees on the yield.
     * If the BPT token is passed in (which doesn't make much sense, but shouldn't fail,
     * since it is a valid pool token), the corresponding flag will be false.
     */
    function isTokenExemptFromYieldProtocolFee(IERC20 token) external view returns (bool) {
        return _isTokenExemptFromYieldProtocolFee(_getTokenIndex(token));
    }

    // This assumes the tokenIndex is valid. If it's not, it will just return false.
    function _isTokenExemptFromYieldProtocolFee(uint256 registeredTokenIndex) internal view returns (bool) {
        return _rateProviderInfoBitmap.decodeBool(registeredTokenIndex);
    }

    // Virtual Supply

    /**
     * @dev Returns the number of tokens in circulation.
     *
     * WARNING: in the vast majority of cases this is not a useful value, since it does not include the debt the Pool
     * accrued in the form of unminted BPT for the ProtocolFeesCollector. Look into `getActualSupply()` and how that's
     * different.
     *
     * In other pools, this would be the same as `totalSupply`, but since this pool pre-mints BPT and holds it in the
     * Vault as a token, we need to subtract the Vault's balance to get the total "circulating supply". Both the
     * totalSupply and Vault balance can change. If users join or exit using swaps, some of the preminted BPT are
     * exchanged, so the Vault's balance increases after joins and decreases after exits. If users call the regular
     * joins/exit functions, the totalSupply can change as BPT are minted for joins or burned for exits.
     */
    function _getVirtualSupply(uint256 bptBalance) internal view returns (uint256) {
        // The initial amount of BPT pre-minted is _PREMINTED_TOKEN_BALANCE, and it goes entirely to the pool balance in
        // the vault. So the virtualSupply (the amount of BPT supply in circulation) is defined as:
        // virtualSupply = totalSupply() - _balances[_bptIndex]
        return totalSupply().sub(bptBalance);
    }
}
