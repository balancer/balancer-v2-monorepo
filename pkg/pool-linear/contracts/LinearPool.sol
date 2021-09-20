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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-pool-utils/contracts/BasePool.sol";
import "@balancer-labs/v2-pool-utils/contracts/interfaces/IRateProvider.sol";
import "@balancer-labs/v2-pool-utils/contracts/rates/PriceRateCache.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IGeneralPool.sol";

import "./LinearMath.sol";

/**
 * @dev LinearPool suitable for assets with an equal underlying token with an exact and non-manipulable exchange rate.
 * Requires an external feed of these exchange rates.
 */
contract LinearPool is BasePool, IGeneralPool, LinearMath, IRateProvider {
    using WordCodec for bytes32;
    using FixedPoint for uint256;
    using PriceRateCache for bytes32;

    uint256 private constant _TOTAL_TOKENS = 3; // Main token, wrapped token, BPT
    uint256 private constant _MINIMUM_BPT = 0; // All BPT is minted to the Vault
    uint256 private constant _MAX_TOKEN_BALANCE = 2**(112) - 1;

    IERC20 private immutable _mainToken;
    IERC20 private immutable _wrappedToken;

    uint256 private immutable _bptIndex;
    uint256 private immutable _mainIndex;
    uint256 private immutable _wrappedIndex;

    uint256 private immutable _scalingFactorMainToken;
    uint256 private immutable _scalingFactorWrappedToken;

    uint256 private _lowerTarget;
    uint256 private _upperTarget;

    bytes32 private _wrappedTokenRateCache;
    IRateProvider private immutable _wrappedTokenRateProvider;

    event TargetsSet(uint256 lowerTarget, uint256 upperTarget);
    event WrappedTokenRateUpdated(uint256 rate);
    event WrappedTokenRateProviderSet(IRateProvider indexed provider, uint256 cacheDuration);

    // The constructor arguments are received in a struct to work around stack-too-deep issues
    struct NewPoolParams {
        IVault vault;
        string name;
        string symbol;
        IERC20 mainToken;
        IERC20 wrappedToken;
        uint256 lowerTarget;
        uint256 upperTarget;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        IRateProvider wrappedTokenRateProvider;
        uint256 wrappedTokenRateCacheDuration;
        address owner;
    }

    constructor(NewPoolParams memory params)
        BasePool(
            params.vault,
            IVault.PoolSpecialization.GENERAL,
            params.name,
            params.symbol,
            _sortTokens(params.mainToken, params.wrappedToken, IERC20(this)),
            new address[](_TOTAL_TOKENS),
            params.swapFeePercentage,
            params.pauseWindowDuration,
            params.bufferPeriodDuration,
            params.owner
        )
    {
        // Set tokens
        _mainToken = params.mainToken;
        _wrappedToken = params.wrappedToken;

        // Set token indexes
        (uint256 mainIndex, uint256 wrappedIndex, uint256 bptIndex) = _getSortedTokenIndexes(
            params.mainToken,
            params.wrappedToken,
            IERC20(this)
        );
        _bptIndex = bptIndex;
        _mainIndex = mainIndex;
        _wrappedIndex = wrappedIndex;

        // Set scaling factors
        _scalingFactorMainToken = _computeScalingFactor(params.mainToken);
        _scalingFactorWrappedToken = _computeScalingFactor(params.wrappedToken);

        // Set targets
        _require(params.lowerTarget <= params.upperTarget, Errors.LOWER_GREATER_THAN_UPPER_TARGET);
        _require(params.upperTarget <= _MAX_TOKEN_BALANCE, Errors.UPPER_TARGET_TOO_HIGH);
        _lowerTarget = params.lowerTarget;
        _upperTarget = params.upperTarget;

        // Set wrapped token rate cache
        _wrappedTokenRateProvider = params.wrappedTokenRateProvider;
        emit WrappedTokenRateProviderSet(params.wrappedTokenRateProvider, params.wrappedTokenRateCacheDuration);
        (bytes32 cache, uint256 rate) = _getNewWrappedTokenRateCache(
            params.wrappedTokenRateProvider,
            params.wrappedTokenRateCacheDuration
        );
        _wrappedTokenRateCache = cache;
        emit WrappedTokenRateUpdated(rate);
    }

    function getMainToken() external view returns (address) {
        return address(_mainToken);
    }

    function getWrappedToken() external view returns (address) {
        return address(_wrappedToken);
    }

    function getBptIndex() external view returns (uint256) {
        return _bptIndex;
    }

    function getMainIndex() external view returns (uint256) {
        return _mainIndex;
    }

    function getWrappedIndex() external view returns (uint256) {
        return _wrappedIndex;
    }

    function initialize() external {
        bytes32 poolId = getPoolId();
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(poolId);
        uint256[] memory maxAmountsIn = new uint256[](_TOTAL_TOKENS);
        maxAmountsIn[tokens[0] == IERC20(this) ? 0 : tokens[1] == IERC20(this) ? 1 : 2] = _MAX_TOKEN_BALANCE;

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(tokens),
            maxAmountsIn: maxAmountsIn,
            userData: "",
            fromInternalBalance: false
        });

        getVault().joinPool(poolId, address(this), address(this), request);
    }

    function onSwap(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public override onlyVault(request.poolId) returns (uint256) {
        // Validate indexes.
        // Note, these are no longer used ahead since we can trust the ones used when the pool was registered
        _require(indexIn < _TOTAL_TOKENS && indexOut < _TOTAL_TOKENS, Errors.OUT_OF_BOUNDS);

        _cacheWrappedTokenRateIfNecessary();
        uint256[] memory scalingFactors = _scalingFactors();
        Params memory params = Params({
            fee: getSwapFeePercentage(),
            rate: FixedPoint.ONE,
            lowerTarget: _lowerTarget,
            upperTarget: _upperTarget
        });

        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            _upscaleArray(balances, scalingFactors);
            request.amount = _upscale(request.amount, scalingFactors[indexIn]);
            uint256 amountOut = _onSwapGivenIn(request, balances, params);
            // amountOut tokens are exiting the Pool, so we round down.
            return _downscaleDown(amountOut, scalingFactors[indexOut]);
        } else {
            _upscaleArray(balances, scalingFactors);
            request.amount = _upscale(request.amount, scalingFactors[indexOut]);
            uint256 amountIn = _onSwapGivenOut(request, balances, params);
            // amountIn tokens are entering the Pool, so we round up.
            return _downscaleUp(amountIn, scalingFactors[indexIn]);
        }
    }

    function _onSwapGivenIn(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        if (request.tokenIn == IERC20(this)) {
            return _swapGivenBptIn(request, balances, params);
        } else if (request.tokenIn == _mainToken) {
            return _swapGivenMainIn(request, balances, params);
        } else if (request.tokenIn == _wrappedToken) {
            return _swapGivenWrappedIn(request, balances, params);
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _swapGivenBptIn(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenOut == _mainToken, Errors.INVALID_TOKEN);
        return
            _calcMainOutPerBptIn(
                request.amount,
                balances[_mainIndex],
                balances[_wrappedIndex],
                _MAX_TOKEN_BALANCE - balances[_bptIndex], // _MAX_TOKEN_BALANCE is always greater than BPT balance
                params
            );
    }

    function _swapGivenMainIn(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view whenNotPaused returns (uint256) {
        _require(request.tokenOut == _wrappedToken || request.tokenOut == IERC20(this), Errors.INVALID_TOKEN);
        return
            request.tokenOut == _wrappedToken
                ? _calcWrappedOutPerMainIn(request.amount, balances[_mainIndex], balances[_wrappedIndex], params)
                : _calcBptOutPerMainIn(
                    request.amount,
                    balances[_mainIndex],
                    balances[_wrappedIndex],
                    _MAX_TOKEN_BALANCE - balances[_bptIndex], // _MAX_TOKEN_BALANCE is always greater than BPT balance
                    params
                );
    }

    function _swapGivenWrappedIn(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view whenNotPaused returns (uint256) {
        _require(request.tokenOut == _mainToken, Errors.INVALID_TOKEN);
        return _calcMainOutPerWrappedIn(request.amount, balances[_mainIndex], params);
    }

    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        if (request.tokenOut == IERC20(this)) {
            return _swapGivenBptOut(request, balances, params);
        } else if (request.tokenOut == _mainToken) {
            return _swapGivenMainOut(request, balances, params);
        } else if (request.tokenOut == _wrappedToken) {
            return _swapGivenWrappedOut(request, balances, params);
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _swapGivenBptOut(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenIn == _mainToken, Errors.INVALID_TOKEN);
        return
            _calcMainInPerBptOut(
                request.amount,
                balances[_mainIndex],
                balances[_wrappedIndex],
                _MAX_TOKEN_BALANCE - balances[_bptIndex], // _MAX_TOKEN_BALANCE is always greater than BPT balance
                params
            );
    }

    function _swapGivenMainOut(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenIn == _wrappedToken || request.tokenIn == IERC20(this), Errors.INVALID_TOKEN);
        return
            request.tokenIn == _wrappedToken
                ? _calcWrappedInPerMainOut(request.amount, balances[_mainIndex], balances[_wrappedIndex], params)
                : _calcBptInPerMainOut(
                    request.amount,
                    balances[_mainIndex],
                    balances[_wrappedIndex],
                    _MAX_TOKEN_BALANCE - balances[_bptIndex], // _MAX_TOKEN_BALANCE is always greater than BPT balance
                    params
                );
    }

    function _swapGivenWrappedOut(
        SwapRequest memory request,
        uint256[] memory balances,
        Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenIn == _mainToken, Errors.INVALID_TOKEN);
        return _calcMainInPerWrappedOut(request.amount, balances[_mainIndex], params);
    }

    function _onInitializePool(
        bytes32,
        address,
        address,
        uint256[] memory,
        bytes memory
    ) internal override whenNotPaused returns (uint256, uint256[] memory) {
        // Mint initial BPTs and adds them to the Vault via a special join
        _approve(address(this), address(getVault()), _MAX_TOKEN_BALANCE);
        uint256[] memory amountsIn = new uint256[](_TOTAL_TOKENS);
        amountsIn[_bptIndex] = _MAX_TOKEN_BALANCE;
        return (_MAX_TOKEN_BALANCE, amountsIn);
    }

    function _onJoinPool(
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
        _revert(Errors.UNHANDLED_BY_LINEAR_POOL);
    }

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
        _revert(Errors.UNHANDLED_BY_LINEAR_POOL);
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _getMinimumBpt() internal pure override returns (uint256) {
        return _MINIMUM_BPT;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        if (token == _mainToken) {
            return _scalingFactorMainToken;
        } else if (token == _wrappedToken) {
            return _scalingFactorWrappedToken.mulDown(_getWrappedTokenCachedRate());
        } else if (token == IERC20(this)) {
            return FixedPoint.ONE;
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        uint256[] memory scalingFactors = new uint256[](_TOTAL_TOKENS);
        scalingFactors[_mainIndex] = _scalingFactorMainToken;
        scalingFactors[_wrappedIndex] = _scalingFactorWrappedToken.mulDown(_getWrappedTokenCachedRate());
        scalingFactors[_bptIndex] = FixedPoint.ONE;
        return scalingFactors;
    }

    // Price rates

    function getRate() public view override returns (uint256) {
        bytes32 poolId = getPoolId();
        (, uint256[] memory balances, ) = getVault().getPoolTokens(poolId);
        _upscaleArray(balances, _scalingFactors());
        uint256 totalBalance = balances[_mainIndex] + balances[_wrappedIndex];
        return totalBalance.divUp(_MAX_TOKEN_BALANCE - balances[_bptIndex]);
    }

    function getWrappedTokenRateProvider() public view returns (IRateProvider) {
        return _wrappedTokenRateProvider;
    }

    function getWrappedTokenRateCache()
        external
        view
        returns (
            uint256 rate,
            uint256 duration,
            uint256 expires
        )
    {
        rate = _wrappedTokenRateCache.getValue();
        (duration, expires) = _wrappedTokenRateCache.getTimestamps();
    }

    function setWrappedTokenRateCacheDuration(uint256 duration) external authenticate {
        _updateWrappedTokenRateCache(duration);
        emit WrappedTokenRateProviderSet(getWrappedTokenRateProvider(), duration);
    }

    function updateWrappedTokenRateCache() external {
        _updateWrappedTokenRateCache(_wrappedTokenRateCache.getDuration());
    }

    function _cacheWrappedTokenRateIfNecessary() internal {
        (uint256 duration, uint256 expires) = _wrappedTokenRateCache.getTimestamps();
        // solhint-disable-next-line not-rely-on-time
        if (block.timestamp > expires) {
            _updateWrappedTokenRateCache(duration);
        }
    }

    function _updateWrappedTokenRateCache(uint256 duration) private {
        (bytes32 cache, uint256 rate) = _getNewWrappedTokenRateCache(_wrappedTokenRateProvider, duration);
        _wrappedTokenRateCache = cache;
        emit WrappedTokenRateUpdated(rate);
    }

    function _getNewWrappedTokenRateCache(IRateProvider provider, uint256 duration)
        private
        view
        returns (bytes32 cache, uint256 rate)
    {
        rate = provider.getRate();
        cache = PriceRateCache.encode(rate, duration);
    }

    function _getWrappedTokenCachedRate() internal view virtual returns (uint256) {
        return _wrappedTokenRateCache.getValue();
    }

    function getTargets() external view returns (uint256 lowerTarget, uint256 upperTarget) {
        return (_lowerTarget, _upperTarget);
    }

    function setTargets(uint256 lowerTarget, uint256 upperTarget) external authenticate {
        _require(lowerTarget <= upperTarget, Errors.LOWER_GREATER_THAN_UPPER_TARGET);
        _require(upperTarget <= _MAX_TOKEN_BALANCE, Errors.UPPER_TARGET_TOO_HIGH);

        bytes32 poolId = getPoolId();
        (, uint256[] memory balances, ) = getVault().getPoolTokens(poolId);

        // Targets can only be set when main token balance between targets (free zone)
        bool isBetweenTargets = balances[_mainIndex] >= _lowerTarget && balances[_mainIndex] <= _upperTarget;
        _require(isBetweenTargets, Errors.OUT_OF_TARGET_RANGE);

        _lowerTarget = lowerTarget;
        _upperTarget = upperTarget;
        emit TargetsSet(lowerTarget, upperTarget);
    }

    function _isOwnerOnlyAction(bytes32 actionId) internal view virtual override returns (bool) {
        return
            (actionId == getActionId(this.setTargets.selector)) ||
            (actionId == getActionId(this.setWrappedTokenRateCacheDuration.selector)) ||
            super._isOwnerOnlyAction(actionId);
    }
}
