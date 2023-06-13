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
import "@balancer-labs/v2-interfaces/contracts/pool-utils/BasePoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-linear/ILinearPool.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IGeneralPool.sol";

import "@balancer-labs/v2-pool-utils/contracts/NewBasePool.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/PoolRegistrationLib.sol";
import "@balancer-labs/v2-pool-utils/contracts/lib/VaultReentrancyLib.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/ERC20Helpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ScalingHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "./LinearMath.sol";

/**
 * @dev Linear Pools are designed to hold two assets: "main" and "wrapped" tokens that have an equal value underlying
 * token (e.g., DAI and waDAI). There must be an external feed available to provide an exact, non-manipulable exchange
 * rate between the tokens. In particular, any reversible manipulation (e.g. causing the rate to increase and then
 * decrease) can lead to severe issues and loss of funds.
 *
 * The Pool will register three tokens in the Vault however: the two assets and the BPT itself,
 * so that BPT can be exchanged (effectively joining and exiting) via swaps.
 *
 * Despite inheriting from BasePool, much of the basic behavior changes. This Pool does not support regular joins
 * and exits, as the initial BPT supply is 'preminted' during initialization. No further BPT can be minted, and BPT can
 * only be burned if governance enables Recovery Mode and LPs use it to exit proportionally.
 *
 * Unlike most other Pools, this one does not attempt to create revenue by charging fees: value is derived by holding
 * the wrapped, yield-bearing asset. However, the 'swap fee percentage' value is still used, albeit with a different
 * meaning. This Pool attempts to hold a certain amount of "main" tokens, between a lower and upper target value.
 * The pool charges fees on trades that move the balance outside that range, which are then paid back as incentives to
 * traders whose swaps return the balance to the desired region.
 *
 * The net revenue via fees is expected to be zero: all collected fees are used to pay for this 'rebalancing'.
 * Accordingly, this Pool does not pay any protocol fees.
 */
abstract contract LinearPool is ILinearPool, IGeneralPool, IRateProvider, NewBasePool {
    using WordCodec for bytes32;
    using FixedPoint for uint256;
    using BasePoolUserData for bytes;

    uint256 private constant _TOTAL_TOKENS = 3; // Main token, wrapped token, BPT

    // This is the maximum token amount the Vault can hold. In regular operation, the total BPT supply remains constant
    // and equal to _INITIAL_BPT_SUPPLY, but most of it remains in the Pool, waiting to be exchanged for tokens. The
    // actual amount of BPT in circulation is the total supply minus the amount held by the Pool, and is known as the
    // 'virtual supply'.
    // The total supply can only change if recovery mode is enabled and recovery mode exits are processed, resulting in
    // BPT being burned. This BPT can never be minted again, so it is technically possible for the preminted supply to
    // run out, but a) this process is controlled by Governance via enabling and disabling recovery mode, and b) the
    // initial supply is so large that it would take a huge number of interactions to acquire sufficient tokens to join
    // the Pool, and then burn the acquired BPT, resulting in prohibitively large gas costs.
    uint256 private constant _INITIAL_BPT_SUPPLY = 2**(112) - 1;

    // 1e18 corresponds to 1.0, or a 100% fee
    uint256 private constant _MIN_SWAP_FEE_PERCENTAGE = 1e12; // 0.0001%
    uint256 private constant _MAX_SWAP_FEE_PERCENTAGE = 1e17; // 10%

    IERC20 private immutable _mainToken;
    IERC20 private immutable _wrappedToken;

    // The indices of each token when registered, which can then be used to access the balances array.
    uint256 private immutable _mainIndex;
    uint256 private immutable _wrappedIndex;

    // Both BPT and the main token have a regular, constant scaling factor (equal to FixedPoint.ONE for BPT, and
    // dependent on the number of decimals for the main token). However, the wrapped token's scaling factor has two
    // components: the usual token decimal scaling factor, and an externally provided rate used to convert wrapped
    // tokens to an equivalent main token amount. This external rate is expected to be ever increasing, reflecting the
    // fact that the wrapped token appreciates in value over time (e.g. because it is accruing interest).
    uint256 private immutable _scalingFactorMainToken;
    uint256 private immutable _scalingFactorWrappedToken;

    // The lower and upper targets are stored in the pool state field, along with the swap fee percentage and recovery
    // mode flag, which together take up 64 bits).
    bytes32 private _poolState;

    // The targets are already scaled by the main token's scaling factor (which makes the token behave as if it had 18
    // decimals), but we only store the integer part: the targets must be multiplied by 1e18 before being used.
    // This means the targets' resolution does not include decimal places in the main token (so e.g. a target of 500.1
    // DAI is impossible). Since targets are expected to be relatively large, this is a non-issue. With 32 bits per
    // target, we can represent values as high as ~4 billion (2^32).
    // [   1 bit  |  63 bits  |    32 bits   |    32 bits    | 128 bits ]
    // [ recovery | swap  fee | upper target |  lower target | reserved ]
    // [ MSB                                                        LSB ]

    uint256 private constant _TARGET_SCALING = 1e18;

    uint256 private constant _TARGET_BITS = 32;

    uint256 private constant _LOWER_TARGET_OFFSET = 32;
    uint256 private constant _UPPER_TARGET_OFFSET = 64;
    uint256 private constant _SWAP_FEE_PERCENTAGE_OFFSET = 192;
    uint256 private constant _RECOVERY_MODE_BIT_OFFSET = 255;

    // A fee can never be larger than FixedPoint.ONE, which fits in 60 bits, so 63 is more than enough.
    uint256 private constant _SWAP_FEE_PERCENTAGE_BIT_LENGTH = 63;

    uint256 private constant _MAX_UPPER_TARGET = (2**(32) - 1) * _TARGET_SCALING;

    // Composable Pool registration will put the BPT at index 0, with the main/wrapped following in sorted order.
    uint256 private constant _BPT_INDEX = 0;

    event SwapFeePercentageChanged(uint256 swapFeePercentage);
    event TargetsSet(IERC20 indexed token, uint256 lowerTarget, uint256 upperTarget);

    /**
     * @dev Ensure we are not in a Vault context when this function is called, by attempting a no-op internal
     * balance operation. If we are already in a Vault transaction (e.g., a swap, join, or exit), the Vault's
     * reentrancy protection will cause this function to revert.
     *
     * Use this modifier with any function that can cause a state change in a pool and is either public itself,
     * or called by a public function *outside* a Vault operation (e.g., join, exit, or swap).
     * See https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345 for reference.
     */
    modifier whenNotInVaultContext() {
        _ensureNotInVaultContext();
        _;
    }

    /**
     * @dev Reverts if called in the middle of a Vault operation; has no effect otherwise.
     */
    function _ensureNotInVaultContext() private view {
        VaultReentrancyLib.ensureNotInVaultContext(getVault());
    }

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20 mainToken,
        IERC20 wrappedToken,
        uint256 upperTarget,
        address[] memory assetManagers,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        NewBasePool(
            vault,
            PoolRegistrationLib.registerComposablePool(
                vault,
                IVault.PoolSpecialization.GENERAL,
                _sortTokens(mainToken, wrappedToken),
                assetManagers
            ),
            name,
            symbol,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        // Set tokens
        _mainToken = mainToken;
        _wrappedToken = wrappedToken;

        // Set token indexes. BPT is always 0; other tokens follow in sorted order.
        _mainIndex = mainToken < wrappedToken ? 1 : 2;
        _wrappedIndex = mainToken < wrappedToken ? 2 : 1;

        // Set scaling factors
        _scalingFactorMainToken = _computeScalingFactor(mainToken);
        _scalingFactorWrappedToken = _computeScalingFactor(wrappedToken);

        // Set initial targets. The lower target must be set to zero because initially there are no accumulated fees.
        // Otherwise the pool would owe fees from the start, which would make the rate manipulable.
        uint256 lowerTarget = 0;
        _setTargets(mainToken, lowerTarget, upperTarget);

        // Set the initial swap fee percentage.
        _setSwapFeePercentage(swapFeePercentage);
    }

    /**
     * @notice Return the main token address as an IERC20.
     */
    function getMainToken() public view override returns (IERC20) {
        return _mainToken;
    }

    /**
     * @notice Return the wrapped token address as an IERC20.
     */
    function getWrappedToken() public view override returns (IERC20) {
        return _wrappedToken;
    }

    /**
     * @notice Return the index of the BPT token.
     * @dev Note that this is an index into the registered token list (with 3 tokens).
     */
    function getBptIndex() public pure override returns (uint256) {
        return _BPT_INDEX;
    }

    /**
     * @notice Return the index of the main token.
     * @dev Note that this is an index into the registered token list, which includes the BPT token.
     */
    function getMainIndex() external view override returns (uint256) {
        return _mainIndex;
    }

    /**
     * @notice Return the index of the wrapped token.
     * @dev Note that this is an index into the registered token list, which includes the BPT token.
     */
    function getWrappedIndex() external view override returns (uint256) {
        return _wrappedIndex;
    }

    /**
     * @dev Finishes initialization of the Linear Pool: it is unusable before calling this function as no BPT will
     * have been minted.
     *
     * Since Linear Pools have preminted BPT stored in the Vault, they require an initial join to deposit said BPT as
     * their balance. Unfortunately, this cannot be performed during construction, as a join involves calling the
     * `onJoinPool` function on the Pool, and the Pool will not have any code until construction finishes. Therefore,
     * this must happen in a separate call.
     *
     * It is highly recommended to create Linear pools using the LinearPoolFactory, which calls `initialize`
     * automatically.
     */
    function initialize() external {
        bytes32 poolId = getPoolId();
        (IERC20[] memory tokens, , ) = getVault().getPoolTokens(poolId);

        // Joins typically involve the Pool receiving tokens in exchange for newly-minted BPT. In this case however, the
        // Pool will mint the entire BPT supply to itself, and join itself with it.
        uint256[] memory maxAmountsIn = new uint256[](_TOTAL_TOKENS);
        maxAmountsIn[_BPT_INDEX] = _INITIAL_BPT_SUPPLY;

        // The first time this executes, it will call `_onInitializePool` (as the BPT supply will be zero). Future calls
        // will be routed to `_onJoinPool`, which always reverts, meaning `initialize` will only execute once.
        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest({
            assets: _asIAsset(tokens),
            maxAmountsIn: maxAmountsIn,
            userData: "",
            fromInternalBalance: false
        });

        getVault().joinPool(poolId, address(this), address(this), request);
    }

    /**
     * @dev Implement the BasePool hook for a general swap (see `IGeneralPool`).
     */
    function _onSwapGeneral(
        SwapRequest memory request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal view override returns (uint256) {
        // In most Pools, swaps involve exchanging one token held by the Pool for another. In this case however, since
        // one of the three tokens is the BPT itself, a swap might also be a join (main/wrapped for BPT) or an exit
        // (BPT for main/wrapped).
        // All three swap types (swaps, joins and exits) are fully disabled if the emergency pause is enabled. Under
        // these circumstances, the Pool can only be exited using Recovery Mode, if it is enabled.

        // Sanity check: this is not entirely necessary as the Vault's interface enforces the indices to be valid, but
        // the check is cheap to perform.
        _require(indexIn < _TOTAL_TOKENS && indexOut < _TOTAL_TOKENS, Errors.OUT_OF_BOUNDS);

        // Note that we already know the indices of the main token, wrapped token and BPT, so there is no need to pass
        // these indices to the inner functions.

        // Upscale balances by the scaling factors (taking into account the wrapped token rate)
        uint256[] memory scalingFactors = getScalingFactors();
        _upscaleArray(balances, scalingFactors);

        (uint256 lowerTarget, uint256 upperTarget) = getTargets();
        LinearMath.Params memory params = LinearMath.Params({
            fee: getSwapFeePercentage(),
            lowerTarget: lowerTarget,
            upperTarget: upperTarget
        });

        if (request.kind == IVault.SwapKind.GIVEN_IN) {
            // The amount given is for token in, the amount calculated is for token out
            request.amount = _upscale(request.amount, scalingFactors[indexIn]);
            uint256 amountOut = _onSwapGivenIn(request, balances, params);

            // amountOut tokens are exiting the Pool, so we round down.
            return _downscaleDown(amountOut, scalingFactors[indexOut]);
        } else {
            // The amount given is for token out, the amount calculated is for token in
            request.amount = _upscale(request.amount, scalingFactors[indexOut]);
            uint256 amountIn = _onSwapGivenOut(request, balances, params);

            // amountIn tokens are entering the Pool, so we round up.
            return _downscaleUp(amountIn, scalingFactors[indexIn]);
        }
    }

    function _onSwapGivenIn(
        SwapRequest memory request,
        uint256[] memory balances,
        LinearMath.Params memory params
    ) internal view returns (uint256) {
        if (request.tokenIn == this) {
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
        LinearMath.Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenOut == _mainToken || request.tokenOut == _wrappedToken, Errors.INVALID_TOKEN);
        return
            (request.tokenOut == _mainToken ? LinearMath._calcMainOutPerBptIn : LinearMath._calcWrappedOutPerBptIn)(
                request.amount,
                balances[_mainIndex],
                balances[_wrappedIndex],
                _getVirtualSupply(balances[_BPT_INDEX]),
                params
            );
    }

    function _swapGivenMainIn(
        SwapRequest memory request,
        uint256[] memory balances,
        LinearMath.Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenOut == _wrappedToken || request.tokenOut == this, Errors.INVALID_TOKEN);
        return
            request.tokenOut == this
                ? LinearMath._calcBptOutPerMainIn(
                    request.amount,
                    balances[_mainIndex],
                    balances[_wrappedIndex],
                    _getVirtualSupply(balances[_BPT_INDEX]),
                    params
                )
                : LinearMath._calcWrappedOutPerMainIn(request.amount, balances[_mainIndex], params);
    }

    function _swapGivenWrappedIn(
        SwapRequest memory request,
        uint256[] memory balances,
        LinearMath.Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenOut == _mainToken || request.tokenOut == this, Errors.INVALID_TOKEN);
        return
            request.tokenOut == this
                ? LinearMath._calcBptOutPerWrappedIn(
                    request.amount,
                    balances[_mainIndex],
                    balances[_wrappedIndex],
                    _getVirtualSupply(balances[_BPT_INDEX]),
                    params
                )
                : LinearMath._calcMainOutPerWrappedIn(request.amount, balances[_mainIndex], params);
    }

    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256[] memory balances,
        LinearMath.Params memory params
    ) internal view returns (uint256) {
        if (request.tokenOut == this) {
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
        LinearMath.Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenIn == _mainToken || request.tokenIn == _wrappedToken, Errors.INVALID_TOKEN);
        return
            (request.tokenIn == _mainToken ? LinearMath._calcMainInPerBptOut : LinearMath._calcWrappedInPerBptOut)(
                request.amount,
                balances[_mainIndex],
                balances[_wrappedIndex],
                _getVirtualSupply(balances[_BPT_INDEX]),
                params
            );
    }

    function _swapGivenMainOut(
        SwapRequest memory request,
        uint256[] memory balances,
        LinearMath.Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenIn == _wrappedToken || request.tokenIn == this, Errors.INVALID_TOKEN);
        return
            request.tokenIn == this
                ? LinearMath._calcBptInPerMainOut(
                    request.amount,
                    balances[_mainIndex],
                    balances[_wrappedIndex],
                    _getVirtualSupply(balances[_BPT_INDEX]),
                    params
                )
                : LinearMath._calcWrappedInPerMainOut(request.amount, balances[_mainIndex], params);
    }

    function _swapGivenWrappedOut(
        SwapRequest memory request,
        uint256[] memory balances,
        LinearMath.Params memory params
    ) internal view returns (uint256) {
        _require(request.tokenIn == _mainToken || request.tokenIn == this, Errors.INVALID_TOKEN);
        return
            request.tokenIn == this
                ? LinearMath._calcBptInPerWrappedOut(
                    request.amount,
                    balances[_mainIndex],
                    balances[_wrappedIndex],
                    _getVirtualSupply(balances[_BPT_INDEX]),
                    params
                )
                : LinearMath._calcMainInPerWrappedOut(request.amount, balances[_mainIndex], params);
    }

    function _onInitializePool(
        address sender,
        address recipient,
        bytes memory
    ) internal view override returns (uint256, uint256[] memory) {
        // Linear Pools can only be initialized by the Pool performing the initial join via the `initialize` function.
        _require(sender == address(this), Errors.INVALID_INITIALIZATION);
        _require(recipient == address(this), Errors.INVALID_INITIALIZATION);

        // The full BPT supply will be minted and deposited in the Pool. Note that there is no need to approve the Vault
        // as it already has infinite BPT allowance.
        uint256 bptAmountOut = _INITIAL_BPT_SUPPLY;

        uint256[] memory amountsIn = new uint256[](_TOTAL_TOKENS);
        amountsIn[_BPT_INDEX] = _INITIAL_BPT_SUPPLY;

        return (bptAmountOut, amountsIn);
    }

    function _onSwapMinimal(
        SwapRequest memory,
        uint256,
        uint256
    ) internal pure override returns (uint256) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onJoinPool(
        address,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _onExitPool(
        address,
        uint256[] memory,
        bytes memory
    ) internal pure override returns (uint256, uint256[] memory) {
        _revert(Errors.UNIMPLEMENTED);
    }

    function _doRecoveryModeExit(
        uint256[] memory registeredBalances,
        uint256,
        bytes memory userData
    ) internal view override returns (uint256, uint256[] memory) {
        uint256 bptAmountIn = userData.recoveryModeExit();
        uint256[] memory amountsOut = new uint256[](registeredBalances.length);

        uint256 bptIndex = getBptIndex();

        uint256 virtualSupply = _getVirtualSupply(registeredBalances[bptIndex]);
        uint256 bptRatio = bptAmountIn.divDown(virtualSupply);

        for (uint256 i = 0; i < registeredBalances.length; i++) {
            amountsOut[i] = i != bptIndex ? registeredBalances[i].mulDown(bptRatio) : 0;
        }

        return (bptAmountIn, amountsOut);
    }

    function _getMinimumBpt() internal pure override returns (uint256) {
        // Linear Pools don't lock any BPT, as the total supply will already be forever non-zero due to the preminting
        // mechanism, ensuring initialization only occurs once.
        return 0;
    }

    // Scaling factors

    function _scalingFactor(IERC20 token) internal view virtual returns (uint256) {
        if (token == _mainToken) {
            return _scalingFactorMainToken;
        } else if (token == _wrappedToken) {
            // The wrapped token's scaling factor is not constant, but increases over time as the wrapped token
            // increases in value.
            return _scalingFactorWrappedToken.mulDown(_getWrappedTokenRate());
        } else if (token == this) {
            return FixedPoint.ONE;
        } else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    /**
     * @notice Return the scaling factors for all tokens, including the BPT.
     */
    function getScalingFactors() public view virtual override returns (uint256[] memory) {
        uint256[] memory scalingFactors = new uint256[](_TOTAL_TOKENS);

        // The wrapped token's scaling factor is not constant, but increases over time as the wrapped token increases in
        // value.
        scalingFactors[_mainIndex] = _scalingFactorMainToken;
        scalingFactors[_wrappedIndex] = _scalingFactorWrappedToken.mulDown(_getWrappedTokenRate());
        scalingFactors[_BPT_INDEX] = FixedPoint.ONE;

        return scalingFactors;
    }

    // Price rates

    /**
     * @dev For a Linear Pool, the rate represents the appreciation of BPT with respect to the underlying tokens. This
     * rate increases slowly as the wrapped token appreciates in value.
     *
     * WARNING: since this function reads balances directly from the Vault, it is potentially subject to manipulation
     * via reentrancy. See https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345 for reference.
     *
     * To call this function safely, attempt to trigger the reentrancy guard in the Vault by calling a non-reentrant
     * function before calling `getRate`. That will make the transaction revert in an unsafe context.
     * (See `whenNotInVaultContext`).
     */
    function getRate() external view override returns (uint256) {
        bytes32 poolId = getPoolId();
        (, uint256[] memory balances, ) = getVault().getPoolTokens(poolId);
        _upscaleArray(balances, getScalingFactors());

        (uint256 lowerTarget, uint256 upperTarget) = getTargets();
        LinearMath.Params memory params = LinearMath.Params({
            fee: getSwapFeePercentage(),
            lowerTarget: lowerTarget,
            upperTarget: upperTarget
        });

        uint256 totalBalance = LinearMath._calcInvariant(
            LinearMath._toNominal(balances[_mainIndex], params),
            balances[_wrappedIndex]
        );

        // Note that we're dividing by the virtual supply, which may be zero (causing this call to revert). However, the
        // only way for that to happen would be for all LPs to exit the Pool, and nothing prevents new LPs from
        // joining it later on.
        return totalBalance.divUp(_getVirtualSupply(balances[_BPT_INDEX]));
    }

    /**
     * @notice Return the conversion rate between the wrapped and main tokens.
     * @dev This is an 18-decimal fixed point value.
     */
    function getWrappedTokenRate() external view returns (uint256) {
        return _getWrappedTokenRate();
    }

    /**
     * @dev Returns a 18-decimal fixed point value that represents the value of the wrapped token in terms of the main
     * token. The final wrapped token scaling factor is this value multiplied by the wrapped token's decimal scaling
     * factor.
     *
     * WARNING: care must be take if calling external contracts from here, even `view` or `pure` functions. If said
     * calls revert, any revert data must not be bubbled-up directly but instead passed to `bubbleUpNonMaliciousRevert`
     * from `ExternalCallLib` (located in the `v2-pool-utils` package). See the following example:
     *
     *  try externalContract.someCall() returns (uint256 value) {
     *    return value;
     *  } catch (bytes memory revertData) {
     *    // Don't automatically bubble-up revert data.
     *    ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
     *  }
     */
    function _getWrappedTokenRate() internal view virtual returns (uint256);

    // Targets

    /// @inheritdoc ILinearPool
    function getTargets() public view override returns (uint256 lowerTarget, uint256 upperTarget) {
        bytes32 poolState = _poolState;

        // Since targets are stored downscaled by _TARGET_SCALING, we undo that when reading them.
        lowerTarget = poolState.decodeUint(_LOWER_TARGET_OFFSET, _TARGET_BITS) * _TARGET_SCALING;
        upperTarget = poolState.decodeUint(_UPPER_TARGET_OFFSET, _TARGET_BITS) * _TARGET_SCALING;
    }

    /// @inheritdoc ILinearPool
    function setTargets(uint256 newLowerTarget, uint256 newUpperTarget)
        external
        override
        authenticate
        whenNotInVaultContext
    {
        (uint256 currentLowerTarget, uint256 currentUpperTarget) = getTargets();
        _require(_isMainBalanceWithinTargets(currentLowerTarget, currentUpperTarget), Errors.OUT_OF_TARGET_RANGE);
        _require(_isMainBalanceWithinTargets(newLowerTarget, newUpperTarget), Errors.OUT_OF_NEW_TARGET_RANGE);

        _setTargets(_mainToken, newLowerTarget, newUpperTarget);
    }

    function _setTargets(
        IERC20 mainToken,
        uint256 lowerTarget,
        uint256 upperTarget
    ) private {
        _require(lowerTarget <= upperTarget, Errors.LOWER_GREATER_THAN_UPPER_TARGET);
        _require(upperTarget <= _MAX_UPPER_TARGET, Errors.UPPER_TARGET_TOO_HIGH);

        // Targets are stored downscaled by _TARGET_SCALING to make them fit in _TARGET_BITS at the cost of some
        // resolution. We check that said resolution is not being used before downscaling.

        _require(upperTarget % _TARGET_SCALING == 0, Errors.FRACTIONAL_TARGET);
        _require(lowerTarget % _TARGET_SCALING == 0, Errors.FRACTIONAL_TARGET);

        _poolState = _poolState
            .insertUint(lowerTarget / _TARGET_SCALING, _LOWER_TARGET_OFFSET, _TARGET_BITS)
            .insertUint(upperTarget / _TARGET_SCALING, _UPPER_TARGET_OFFSET, _TARGET_BITS);

        emit TargetsSet(mainToken, lowerTarget, upperTarget);
    }

    function _isMainBalanceWithinTargets(uint256 lowerTarget, uint256 upperTarget) private view returns (bool) {
        (uint256 cash, uint256 managed, , ) = getVault().getPoolTokenInfo(getPoolId(), _mainToken);

        uint256 mainTokenBalance = _upscale(cash + managed, _scalingFactor(_mainToken));

        return mainTokenBalance >= lowerTarget && mainTokenBalance <= upperTarget;
    }

    // Swap Fees

    function getSwapFeePercentage() public view virtual override returns (uint256) {
        return _poolState.decodeUint(_SWAP_FEE_PERCENTAGE_OFFSET, _SWAP_FEE_PERCENTAGE_BIT_LENGTH);
    }

    /// @inheritdoc ILinearPool
    function setSwapFeePercentage(uint256 swapFeePercentage) external override authenticate whenNotInVaultContext {
        // For the swap fee percentage to be changeable:
        //  - the pool must currently be between the current targets (meaning no fees are currently pending)
        //
        // As the amount of accrued fees is not explicitly stored but rather derived from the main token balance and the
        // current swap fee percentage, requiring for no fees to be pending prevents the fee setter from changing the
        // amount of pending fees, which they could use to e.g. drain Pool funds in the form of inflated fees.

        (uint256 lowerTarget, uint256 upperTarget) = getTargets();
        _require(_isMainBalanceWithinTargets(lowerTarget, upperTarget), Errors.OUT_OF_TARGET_RANGE);

        _setSwapFeePercentage(swapFeePercentage);
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

    // Virtual Supply

    /**
     * @notice Returns the number of tokens in circulation.
     *
     * @dev In other pools, this would be the same as `totalSupply`, but since this pool pre-mints BPT and holds it in
     * the Vault as a token, we need to subtract the Vault's balance to get the total "circulating supply". Both the
     * totalSupply and Vault balance can change. If users join or exit using swaps, some of the preminted BPT are
     * exchanged, so the Vault's balance increases after joins and decreases after exits. If users call the recovery
     * mode exit function, the totalSupply can change as BPT are burned.
     *
     * WARNING: since this function reads balances directly from the Vault, it is potentially subject to manipulation
     * via reentrancy. See https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345 for reference.
     *
     * To call this function safely, attempt to trigger the reentrancy guard in the Vault by calling a non-reentrant
     * function before calling `getVirtualSupply`. That will make the transaction revert in an unsafe context.
     * (See `whenNotInVaultContext`).
     */
    function getVirtualSupply() external view returns (uint256) {
        // For a 3 token General Pool, it is cheaper to query the balance for a single token than to read all balances,
        // as getPoolTokenInfo will check for token existence, token balance and Asset Manager (3 reads), while
        // getPoolTokens will read the number of tokens, their addresses and balances (7 reads).
        (uint256 cash, uint256 managed, , ) = getVault().getPoolTokenInfo(getPoolId(), IERC20(this));

        // Note that unlike all other balances, the Vault's BPT balance does not need scaling as its scaling factor is
        // ONE. This addition cannot overflow due to the Vault's balance limits.
        return _getVirtualSupply(cash + managed);
    }

    // The initial amount of BPT pre-minted is _PREMINTED_TOKEN_BALANCE, and it goes entirely to the pool balance in the
    // vault. So the virtualSupply (the actual supply in circulation) is defined as:
    // virtualSupply = totalSupply() - _balances[_bptIndex]
    function _getVirtualSupply(uint256 bptBalance) internal view returns (uint256) {
        return totalSupply().sub(bptBalance);
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

    // Misc

    /**
     * @dev Enumerates all ownerOnly functions in Linear Pool.
     */
    function _isOwnerOnlyAction(bytes32 actionId) internal view virtual override returns (bool) {
        return
            actionId == getActionId(this.setTargets.selector) ||
            actionId == getActionId(this.setSwapFeePercentage.selector);
    }
}
