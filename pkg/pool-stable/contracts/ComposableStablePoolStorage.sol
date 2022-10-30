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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/ScalingHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/PoolRegistrationLib.sol";
import "@balancer-labs/v2-pool-utils/contracts/NewBasePool.sol";

import "./StableMath.sol";

abstract contract ComposableStablePoolStorage is NewBasePool {
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    struct StorageParams {
        IERC20[] tokens;
        IRateProvider[] tokenRateProviders;
        bool[] exemptFromYieldProtocolFeeFlags;
        uint256 swapFeePercentage;
    }

    // This minimum refers not to the total tokens, but rather to the non-BPT tokens. The minimum value for _totalTokens
    // is therefore _MIN_NON_BPT_TOKENS + 1.
    uint256 private constant _MIN_NON_BPT_TOKENS = 2;

    // The Pool will register n+1 tokens, where n are the actual tokens in the Pool, and the other one is the BPT
    // itself. `_poolTokens` is the token count NOT including BPT. In general, "pool tokens" and "pool token index"
    // refer to the tokens passed in by and visible to the user. These 0-4 indices correspond to the array storage
    // in this contract.
    //
    // In the rare cases when we need to include BPT (e.g., certain external functions, scaling factors), we refer
    // to the "registered tokens" and "registered index".
    uint256 private immutable _totalPoolTokens;

    // These are the pool tokens (not including BPT)
    IERC20 private immutable _token0;
    IERC20 private immutable _token1;
    IERC20 private immutable _token2;
    IERC20 private immutable _token3;
    IERC20 private immutable _token4;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.

    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;
    uint256 internal immutable _scalingFactor2;
    uint256 internal immutable _scalingFactor3;
    uint256 internal immutable _scalingFactor4;

    // Rate Providers accommodate tokens with a known price ratio, such as Compound's cTokens.

    IRateProvider internal immutable _rateProvider0;
    IRateProvider internal immutable _rateProvider1;
    IRateProvider internal immutable _rateProvider2;
    IRateProvider internal immutable _rateProvider3;
    IRateProvider internal immutable _rateProvider4;

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

    // Storage for the swap fee percentage and recovery mode flag.
    bytes32 private _poolState;
    // [ 192 bits |   1 bit  |  63 bits  ]
    // [  unused  | recovery | swap  fee ]
    // [ MSB                         LSB ]

    uint256 private constant _SWAP_FEE_PERCENTAGE_OFFSET = 0;
    uint256 private constant _RECOVERY_MODE_BIT_OFFSET = _SWAP_FEE_PERCENTAGE_OFFSET + _SWAP_FEE_PERCENTAGE_BIT_LENGTH;

    // A fee can never be larger than FixedPoint.ONE, which fits in 60 bits, so 63 is more than enough.
    uint256 private constant _SWAP_FEE_PERCENTAGE_BIT_LENGTH = 63;

    // 1e18 corresponds to 1.0, or a 100% fee
    uint256 private constant _MIN_SWAP_FEE_PERCENTAGE = 1e12; // 0.0001%
    uint256 private constant _MAX_SWAP_FEE_PERCENTAGE = 1e17; // 10%

    event SwapFeePercentageChanged(uint256 swapFeePercentage);

    constructor(StorageParams memory params) {
        // BasePool checks that the Pool has at least two tokens, but since one of them is the BPT (this contract), we
        // need to check ourselves that there are at least creator-supplied tokens (i.e. the minimum number of total
        // tokens for this contract is actually three, including the BPT).
        uint256 totalPoolTokens = params.tokens.length;
        _require(totalPoolTokens >= _MIN_NON_BPT_TOKENS, Errors.MIN_TOKENS);
        InputHelpers.ensureInputLengthMatch(
            totalPoolTokens,
            params.tokenRateProviders.length,
            params.exemptFromYieldProtocolFeeFlags.length
        );

        _totalPoolTokens = totalPoolTokens;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _token0 = params.tokens[0];
        _token1 = params.tokens[1];
        _token2 = totalPoolTokens > 2 ? params.tokens[2] : IERC20(0);
        _token3 = totalPoolTokens > 3 ? params.tokens[3] : IERC20(0);
        _token4 = totalPoolTokens > 4 ? params.tokens[4] : IERC20(0);

        _scalingFactor0 = _computeScalingFactor(params.tokens[0]);
        _scalingFactor1 = _computeScalingFactor(params.tokens[1]);
        _scalingFactor2 = totalPoolTokens > 2 ? _computeScalingFactor(params.tokens[2]) : 0;
        _scalingFactor3 = totalPoolTokens > 3 ? _computeScalingFactor(params.tokens[3]) : 0;
        _scalingFactor4 = totalPoolTokens > 4 ? _computeScalingFactor(params.tokens[4]) : 0;

        // The rate providers are stored as immutable state variables, and for simplicity when accessing those we'll
        // reference them by token index in the full base tokens plus BPT set (i.e. the tokens the Pool registers). Due
        // to immutable variables requiring an explicit assignment instead of defaulting to an empty value, it is
        // simpler to create a new memory array with the values we want to assign to the immutable state variables.
        IRateProvider[] memory rateProviders = new IRateProvider[](params.tokens.length);

        bytes32 rateProviderInfoBitmap;

        bool anyExempt = false;
        bool anyNonExempt = false;

        // The exemptFromYieldFlag should never be set on a token without a rate provider.
        // This would cause division by zero errors downstream.
        for (uint256 i = 0; i < params.tokens.length; ++i) {
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
        }

        _noTokensExempt = !anyExempt;
        _allTokensExempt = !anyNonExempt;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _rateProvider0 = rateProviders[0];
        _rateProvider1 = rateProviders[1];
        _rateProvider2 = (rateProviders.length > 2) ? rateProviders[2] : IRateProvider(0);
        _rateProvider3 = (rateProviders.length > 3) ? rateProviders[3] : IRateProvider(0);
        _rateProvider4 = (rateProviders.length > 4) ? rateProviders[4] : IRateProvider(0);

        _rateProviderInfoBitmap = rateProviderInfoBitmap;

        // Set the initial swap fee percentage.
        _setSwapFeePercentage(params.swapFeePercentage);
    }

    // Tokens

    // Return the token count, including the BPT.
    function _getTotalTokens() internal view returns (uint256) {
        return _totalPoolTokens + 1;
    }

    // Return the token count, NOT including the BPT.
    function _getTotalPoolTokens() internal view returns (uint256) {
        return _totalPoolTokens;
    }

    // Returns the pool token index of the given token. Should not be called with BPT.
    function _getPoolTokenIndex(IERC20 token) internal view returns (uint256) {
        if (token == _token0) return 0;
        if (token == _token1) return 1;
        if (token == _token2) return 2;
        if (token == _token3) return 3;
        if (token == _token4) return 4;

        _revert(Errors.INVALID_TOKEN);
    }

    function _scalingFactor(IERC20) internal view virtual returns (uint256) {
        // We never use a single token's scaling factor by itself, we always process the entire array at once.
        // Therefore we don't bother providing an implementation for this.
        _revert(Errors.UNIMPLEMENTED);
    }

    // Index helpers

    /**
     * @dev Remove the item at the BPT index (which we know is always 0), from an arbitrary array (e.g., amountsIn).
     */
    function _dropBptItem(uint256[] memory registeredAmounts) internal pure returns (uint256[] memory amounts) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // See ComposablePoolLib.sol in pool-utils for a detailed explanation.
            mstore(add(registeredAmounts, 32), sub(mload(registeredAmounts), 1))
            amounts := add(registeredAmounts, 32)
        }
    }

    /**
     * @dev Same as `_dropBptItem`, except the virtual supply is also returned, and `balances` is assumed to be the
     * current Pool balances (including BPT). This mutates registeredBalances, which can no longer be used.
     */
    function _dropBptItemFromBalances(uint256[] memory registeredBalances)
        internal
        view
        returns (uint256, uint256[] memory)
    {
        return (
            _getVirtualSupply(registeredBalances[PoolRegistrationLib.COMPOSABLE_BPT_INDEX]),
            _dropBptItem(registeredBalances)
        );
    }

    /**
     * @dev Take an array of arbitrary values the size of the token set without BPT, and prepend the given
     * bptAmount, since we know the BPT index is 0.
     *
     * The caller is responsible for ensuring the `amounts` input array is sized properly; this function
     * performs no checks.
     */
    function _addBptItem(uint256[] memory amounts, uint256 bptAmount)
        internal
        pure
        returns (uint256[] memory registeredTokenAmounts)
    {
        registeredTokenAmounts = new uint256[](amounts.length + 1);
        registeredTokenAmounts[0] = bptAmount;

        for (uint256 i = 0; i < amounts.length; i++) {
            registeredTokenAmounts[i + 1] = amounts[i];
        }
    }

    /**
     * @dev Get the scaling factor for the token at the given pool token index (not including BPT).
     */
    function _getScalingFactor(uint256 poolTokenIndex) internal view returns (uint256) {
        if (poolTokenIndex == 0) return _scalingFactor0;
        if (poolTokenIndex == 1) return _scalingFactor1;
        if (poolTokenIndex == 2) return _scalingFactor2;
        if (poolTokenIndex == 3) return _scalingFactor3;
        if (poolTokenIndex == 4) return _scalingFactor4;
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    // Rate Providers

    /**
     * @dev Returns the rate providers configured for each token (not including BPT).
     */
    function getRateProviders() external view returns (IRateProvider[] memory) {
        uint256 totalPoolTokens = _getTotalPoolTokens();
        IRateProvider[] memory providers = new IRateProvider[](totalPoolTokens);

        for (uint256 i = 0; i < totalPoolTokens; ++i) {
            providers[i] = _getRateProvider(i);
        }

        return providers;
    }

    function _getRateProvider(uint256 poolTokenIndex) internal view returns (IRateProvider) {
        if (poolTokenIndex == 0) return _rateProvider0;
        if (poolTokenIndex == 1) return _rateProvider1;
        if (poolTokenIndex == 2) return _rateProvider2;
        if (poolTokenIndex == 3) return _rateProvider3;
        if (poolTokenIndex == 4) return _rateProvider4;
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    /**
     * @notice Return true if the token at this pool token index has a rate provider.
     */
    function _hasRateProvider(uint256 poolTokenIndex) internal view returns (bool) {
        return _rateProviderInfoBitmap.decodeBool(_RATE_PROVIDER_FLAGS_OFFSET + poolTokenIndex);
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
        return _isTokenExemptFromYieldProtocolFee(_getPoolTokenIndex(token));
    }

    // This assumes the poolTokenIndex (not including BPT) is valid. If it's not, it will just return false.
    function _isTokenExemptFromYieldProtocolFee(uint256 poolTokenIndex) internal view returns (bool) {
        return _rateProviderInfoBitmap.decodeBool(poolTokenIndex);
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

    // Swap Fees

    /**
     * @notice Return the current value of the swap fee percentage.
     * @dev This is stored in `_miscData`.
     */
    function getSwapFeePercentage() public view virtual override returns (uint256) {
        return _poolState.decodeUint(_SWAP_FEE_PERCENTAGE_OFFSET, _SWAP_FEE_PERCENTAGE_BIT_LENGTH);
    }

    /**
     * @dev Validate the swap fee, update storage, and emit an event.
     */
    function _setSwapFeePercentage(uint256 swapFeePercentage) internal {
        _require(swapFeePercentage >= _MIN_SWAP_FEE_PERCENTAGE, Errors.MIN_SWAP_FEE_PERCENTAGE);
        _require(swapFeePercentage <= _MAX_SWAP_FEE_PERCENTAGE, Errors.MAX_SWAP_FEE_PERCENTAGE);

        _poolState = _poolState.insertUint(
            swapFeePercentage,
            _SWAP_FEE_PERCENTAGE_OFFSET,
            _SWAP_FEE_PERCENTAGE_BIT_LENGTH
        );

        emit SwapFeePercentageChanged(swapFeePercentage);
    }

    // Recovery Mode

    /**
     * @notice Returns whether the pool is in Recovery Mode.
     */
    function inRecoveryMode() public view override returns (bool) {
        return _poolState.decodeBool(_RECOVERY_MODE_BIT_OFFSET);
    }

    /**
     * @dev Sets the recoveryMode state, and emits the corresponding event.
     */
    function _setRecoveryMode(bool enabled) internal virtual override {
        _poolState = _poolState.insertBool(enabled, _RECOVERY_MODE_BIT_OFFSET);

        emit RecoveryModeStateChanged(enabled);
    }
}
