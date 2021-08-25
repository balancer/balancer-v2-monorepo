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
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-pool-utils/contracts/interfaces/IRateProvider.sol";
import "@balancer-labs/v2-pool-utils/contracts/BaseGeneralPool.sol";

import "./LinearMath.sol";

/**
 * @dev LinearPool suitable for assets with an equal underlying token with an exact and non-manipulable exchange rate.
 * Requires an external feed of these exchange rates.
 */
contract LinearPool is BaseGeneralPool, LinearMath, IRateProvider {
    using FixedPoint for uint256;

    uint256 private constant _TOTAL_TOKENS = 3; //Main token, wrapped token, BPT
    uint256 private constant _MAX_TOKEN_BALANCE = 2**(112) - 1;

    IVault private immutable _vault;

    IERC20 private immutable _mainToken;
    IERC20 private immutable _wrappedToken;

    uint256 private immutable _scalingFactorMainToken;
    uint256 private immutable _scalingFactorWrappedToken;

    uint256 private _lowerTarget;
    uint256 private _upperTarget;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20 mainToken,
        IERC20 wrappedToken,
        uint256 lowerTarget,
        uint256 upperTarget,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BasePool(
            vault,
            IVault.PoolSpecialization.GENERAL,
            name,
            symbol,
            _addBptToTokens(mainToken, wrappedToken),
            new address[](_TOTAL_TOKENS),
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        _mainToken = mainToken;
        _wrappedToken = wrappedToken;

        _scalingFactorMainToken = _computeScalingFactor(mainToken);
        _scalingFactorWrappedToken = _computeScalingFactor(wrappedToken);

        _vault = vault;

        _require(lowerTarget <= upperTarget, Errors.LOWER_GREATER_THAN_UPPER_TARGET);
        _require(upperTarget <= _MAX_TOKEN_BALANCE, Errors.UPPER_TARGET_TOO_HIGH);
        _lowerTarget = lowerTarget;
        _upperTarget = upperTarget;
    }

    function _addBptToTokens(IERC20 mainToken, IERC20 wrappedToken)
        private
        view
        returns (IERC20[] memory updatedTokens)
    {
        IERC20 bptToken = IERC20(this);
        (uint256 mainIndex, uint256 wrappedIndex, uint256 bptIndex) = _getIndexesByTokens(
            mainToken,
            wrappedToken,
            bptToken
        );
        updatedTokens = new IERC20[](_TOTAL_TOKENS);
        updatedTokens[mainIndex] = mainToken;
        updatedTokens[wrappedIndex] = wrappedToken;
        updatedTokens[bptIndex] = bptToken;
    }

    function _getIndexes()
        private
        view
        returns (
            uint256 mainIndex,
            uint256 wrappedIndex,
            uint256 bptIndex
        )
    {
        return _getIndexesByTokens(_mainToken, _wrappedToken, IERC20(this));
    }

    function _getIndexesByTokens(
        IERC20 token0,
        IERC20 token1,
        IERC20 token2
    )
        private
        pure
        returns (
            uint256 indexToken0,
            uint256 indexToken1,
            uint256 indexToken2
        )
    {
        if (token0 < token1) {
            if (token1 < token2) {
                //(token0, token1, token2);
                return (0, 1, 2);
            } else if (token0 < token2) {
                //(token0, token2, token1);
                return (0, 2, 1);
            } else {
                //(token2, token0, token1);
                return (1, 2, 0);
            }
        } else {
            //token1 < token0
            if (token2 < token1) {
                //(token2, token1, token0);
                return (2, 1, 0);
            } else if (token2 < token0) {
                //(token1, token2, token0);
                return (2, 0, 1);
            } else {
                //(token1, token0, token2);
                return (1, 0, 2);
            }
        }
    }

    function _translateToIAsset(IERC20[] memory tokens) private pure returns (IAsset[] memory) {
        IAsset[] memory assets = new IAsset[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            assets[i] = IAsset(address(tokens[i]));
        }
        return assets;
    }

    function initialize() public {
        //TODO: Need to intialize out of the constructor because of poolId, or need to change BasePool

        bytes32 poolId = getPoolId();
        (IERC20[] memory tokens, , ) = _vault.getPoolTokens(poolId);

        uint256[] memory maxAmountsIn = new uint256[](_TOTAL_TOKENS);
        maxAmountsIn[tokens[0] == IERC20(this) ? 0 : tokens[1] == IERC20(this) ? 1 : 2] = _MAX_TOKEN_BALANCE;

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _translateToIAsset(tokens),
            maxAmountsIn: maxAmountsIn,
            userData: "",
            fromInternalBalance: false
        });

        _vault.joinPool(poolId, address(this), address(this), request);
    }

    function onSwap(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) public view override returns (uint256) {
        //Validate Indexes
        _require(indexIn < _TOTAL_TOKENS && indexOut < _TOTAL_TOKENS, Errors.OUT_OF_BOUNDS);
        uint256[] memory scalingFactors = _scalingFactors();

        if (swapRequest.kind == IVault.SwapKind.GIVEN_IN) {
            _upscaleArray(balances, scalingFactors);
            swapRequest.amount = _upscale(swapRequest.amount, scalingFactors[indexIn]);

            uint256 amountOut = _onSwapGivenIn(swapRequest, balances, indexIn, indexOut);

            // amountOut tokens are exiting the Pool, so we round down.
            return _downscaleDown(amountOut, scalingFactors[indexOut]);
        } else {
            _upscaleArray(balances, scalingFactors);
            swapRequest.amount = _upscale(swapRequest.amount, scalingFactors[indexOut]);

            uint256 amountIn = _onSwapGivenOut(swapRequest, balances, indexIn, indexOut);

            // amountIn tokens are entering the Pool, so we round up.
            return _downscaleUp(amountIn, scalingFactors[indexIn]);
        }
    }

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal view override whenNotPaused returns (uint256) {
        Params memory params = Params({
            fee: getSwapFeePercentage(),
            rate: FixedPoint.ONE,
            lowerTarget: _lowerTarget,
            upperTarget: _upperTarget
        });

        (, uint256 wrappedIndex, ) = _getIndexes();

        if (swapRequest.tokenIn == _mainToken) {
            if (swapRequest.tokenOut == _wrappedToken) {
                return _calcWrappedOutPerMainIn(swapRequest.amount, balances[indexIn], balances[indexOut], params);
            } else if (swapRequest.tokenOut == IERC20(this)) {
                return
                    _calcBptOutPerMainIn(
                        swapRequest.amount,
                        balances[indexIn],
                        balances[wrappedIndex],
                        //_MAX_TOKEN_BALANCE is always greater than balanceTokenOut
                        _MAX_TOKEN_BALANCE - balances[indexOut],
                        params
                    );
            } else {
                _revert(Errors.INVALID_TOKEN);
            }
        } else if (swapRequest.tokenOut == _mainToken) {
            if (swapRequest.tokenIn == _wrappedToken) {
                return _calcMainOutPerWrappedIn(swapRequest.amount, balances[indexOut], params);
            } else if (swapRequest.tokenIn == IERC20(this)) {
                return
                    _calcMainOutPerBptIn(
                        swapRequest.amount,
                        balances[indexOut],
                        balances[wrappedIndex],
                        //_MAX_TOKEN_BALANCE is always greater than balanceTokenIn
                        _MAX_TOKEN_BALANCE - balances[indexIn],
                        params
                    );
            } else {
                _revert(Errors.INVALID_TOKEN);
            }
        } else {
            //It does not swap wrapped and BPT
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal view override whenNotPaused returns (uint256) {
        Params memory params = Params({
            fee: getSwapFeePercentage(),
            rate: FixedPoint.ONE,
            lowerTarget: _lowerTarget,
            upperTarget: _upperTarget
        });

        (, uint256 wrappedIndex, ) = _getIndexes();

        if (swapRequest.tokenOut == _mainToken) {
            if (swapRequest.tokenIn == _wrappedToken) {
                return _calcWrappedInPerMainOut(swapRequest.amount, balances[indexOut], balances[indexIn], params);
            } else if (swapRequest.tokenIn == IERC20(this)) {
                return
                    _calcBptInPerMainOut(
                        swapRequest.amount,
                        balances[indexOut],
                        balances[wrappedIndex],
                        //_MAX_TOKEN_BALANCE is always greater than balanceTokenIn
                        _MAX_TOKEN_BALANCE - balances[indexIn],
                        params
                    );
            } else {
                _revert(Errors.INVALID_TOKEN);
            }
        } else if (swapRequest.tokenIn == _mainToken) {
            if (swapRequest.tokenOut == _wrappedToken) {
                return _calcMainInPerWrappedOut(swapRequest.amount, balances[indexIn], params);
            } else if (swapRequest.tokenOut == IERC20(this)) {
                return
                    _calcMainInPerBptOut(
                        swapRequest.amount,
                        balances[indexIn],
                        balances[wrappedIndex],
                        //_MAX_TOKEN_BALANCE is always greater than balanceTokenOut
                        _MAX_TOKEN_BALANCE - balances[indexOut],
                        params
                    );
            } else {
                _revert(Errors.INVALID_TOKEN);
            }
        } else {
            //It does not swap wrapped and BPT
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function onJoinPool(
        bytes32 poolId,
        address,
        address,
        uint256[] memory,
        uint256,
        uint256,
        bytes memory
    ) public override onlyVault(poolId) returns (uint256[] memory, uint256[] memory) {
        if (totalSupply() == 0) {
            //Mint initial BPTs and adds them to the Vault via a special join
            _mintPoolTokens(address(this), _MAX_TOKEN_BALANCE);
            _approve(address(this), address(_vault), _MAX_TOKEN_BALANCE);

            (, , uint256 bptIndex) = _getIndexes();

            uint256[] memory amountsIn = new uint256[](_TOTAL_TOKENS);
            amountsIn[bptIndex] = _MAX_TOKEN_BALANCE;

            return (amountsIn, new uint256[](_TOTAL_TOKENS));
        }
    }

    function _onInitializePool(
        bytes32,
        address,
        address,
        uint256[] memory,
        bytes memory
    ) internal view override whenNotPaused returns (uint256, uint256[] memory) {
        _revert(Errors.UNHANDLED);
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
        view
        override
        whenNotPaused
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        _revert(Errors.UNHANDLED);
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
        _revert(Errors.UNHANDLED);
    }

    function _getMaxTokens() internal pure override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _TOTAL_TOKENS;
    }

    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        // prettier-ignore
        if (token == _mainToken) { return _scalingFactorMainToken; }
        else if (token == _wrappedToken) { return _scalingFactorWrappedToken; }
        else if (token == IERC20(this)) { return FixedPoint.ONE; }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        (uint256 mainIndex, uint256 wrappedIndex, uint256 bptIndex) = _getIndexes();

        uint256[] memory scalingFactors = new uint256[](_TOTAL_TOKENS);
        scalingFactors[mainIndex] = _scalingFactorMainToken;
        scalingFactors[wrappedIndex] = _scalingFactorWrappedToken;
        scalingFactors[bptIndex] = FixedPoint.ONE;

        return scalingFactors;
    }

    function getRate() public view override returns (uint256) {
        bytes32 poolId = getPoolId();
        (, uint256[] memory balances, ) = _vault.getPoolTokens(poolId);
        (uint256 mainIndex, uint256 wrappedIndex, uint256 bptIndex) = _getIndexes();

        _upscaleArray(balances, _scalingFactors());

        return (balances[mainIndex] + balances[wrappedIndex]).divUp(_MAX_TOKEN_BALANCE - balances[bptIndex]);
    }

    //TODO: update Targets

    //TODO: external rates
}
