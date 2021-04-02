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

import "../lib/math/FixedPoint.sol";
import "../lib/helpers/InputHelpers.sol";
import "../lib/helpers/EmergencyPeriod.sol";
import "../lib/openzeppelin/ERC20.sol";

import "./BalancerPoolToken.sol";
import "./BasePoolAuthorization.sol";
import "../vault/interfaces/IVault.sol";
import "../vault/interfaces/IBasePool.sol";

// This contract relies on tons of immutable state variables to perform efficient lookup, without resorting to storage
// reads. Because immutable arrays are not supported, we instead declare a fixed set of state variables plus total
// count, resulting in a large number of these.

// solhint-disable max-states-count

/**
 * @dev Reference implementation for the base layer of a Pool contract that manages a single Pool with an immutable set
 * of registered tokens, no Asset Managers, and admin-controlled swap fee and emergency stop mechanisms.
 *
 * Note that both swap fees and the emergency stop mechanism are not used by this contract, but instead exposed so that
 * derived contracts can use them via the `_addSwapFee` and `_subtractSwapFee` functions, and the `noEmergencyPeriod`
 * modifier, respectively.
 *
 * No admin permissions are checked here: instead, this contract delegates that to the Vault's own Authorizer.
 *
 * Because this contract doesn't implement the swap hooks, derived contracts should inherit from BaseGeneralPool or
 * BaseMinimalSwapInfoPool instead. Additionally, they must implement the `_onInitializePool`, `_onJoinPool` and
 * `_onExitPool` virtual functions.
 */
abstract contract BasePool is IBasePool, BasePoolAuthorization, BalancerPoolToken, EmergencyPeriod {
    using FixedPoint for uint256;

    uint256 private constant _MIN_TOKENS = 2;
    uint256 private constant _MAX_TOKENS = 16;

    // 1e16 = 1%, 1e18 = 100%
    uint256 private constant _MAX_SWAP_FEE = 10e16;

    uint256 private constant _MINIMUM_BPT = 10**3;

    uint256 internal _swapFee;

    IVault internal immutable _vault;
    bytes32 internal immutable _poolId;
    uint256 internal immutable _totalTokens;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    IERC20 internal immutable _token2;
    IERC20 internal immutable _token3;
    IERC20 internal immutable _token4;
    IERC20 internal immutable _token5;
    IERC20 internal immutable _token6;
    IERC20 internal immutable _token7;
    IERC20 internal immutable _token8;
    IERC20 internal immutable _token9;
    IERC20 internal immutable _token10;
    IERC20 internal immutable _token11;
    IERC20 internal immutable _token12;
    IERC20 internal immutable _token13;
    IERC20 internal immutable _token14;
    IERC20 internal immutable _token15;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.

    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;
    uint256 internal immutable _scalingFactor2;
    uint256 internal immutable _scalingFactor3;
    uint256 internal immutable _scalingFactor4;
    uint256 internal immutable _scalingFactor5;
    uint256 internal immutable _scalingFactor6;
    uint256 internal immutable _scalingFactor7;
    uint256 internal immutable _scalingFactor8;
    uint256 internal immutable _scalingFactor9;
    uint256 internal immutable _scalingFactor10;
    uint256 internal immutable _scalingFactor11;
    uint256 internal immutable _scalingFactor12;
    uint256 internal immutable _scalingFactor13;
    uint256 internal immutable _scalingFactor14;
    uint256 internal immutable _scalingFactor15;

    event SwapFeeChanged(uint256 swapFee);

    constructor(
        IVault vault,
        IVault.PoolSpecialization specialization,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 swapFee,
        uint256 emergencyPeriod,
        uint256 emergencyPeriodCheckExtension
    ) BalancerPoolToken(name, symbol) EmergencyPeriod(emergencyPeriod, emergencyPeriodCheckExtension) {
        _require(tokens.length >= _MIN_TOKENS, Errors.MIN_TOKENS);
        _require(tokens.length <= _MAX_TOKENS, Errors.MAX_TOKENS);

        // The Vault only requires the token list to be ordered for the Two Token Pools specialization. However,
        // to make the developer experience consistent, we are requiring this condition for all the native pools.
        // Also, since these Pools will register tokens only once, we can ensure the Pool tokens will follow the same
        // order. We rely on this property to make Pools simpler to write, as it lets us assume that the
        // order of token-specific parameters (such as token weights) will not change.
        InputHelpers.ensureArrayIsSorted(tokens);

        _require(swapFee <= _MAX_SWAP_FEE, Errors.MAX_SWAP_FEE);

        bytes32 poolId = vault.registerPool(specialization);

        // Pass in zero addresses for Asset Managers
        vault.registerTokens(poolId, tokens, new address[](tokens.length));

        // Set immutable state variables - these cannot be read from during construction

        _vault = vault;
        _poolId = poolId;
        _swapFee = swapFee;
        _totalTokens = tokens.length;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments

        _token0 = tokens.length > 0 ? tokens[0] : IERC20(0);
        _token1 = tokens.length > 1 ? tokens[1] : IERC20(0);
        _token2 = tokens.length > 2 ? tokens[2] : IERC20(0);
        _token3 = tokens.length > 3 ? tokens[3] : IERC20(0);
        _token4 = tokens.length > 4 ? tokens[4] : IERC20(0);
        _token5 = tokens.length > 5 ? tokens[5] : IERC20(0);
        _token6 = tokens.length > 6 ? tokens[6] : IERC20(0);
        _token7 = tokens.length > 7 ? tokens[7] : IERC20(0);
        _token8 = tokens.length > 8 ? tokens[8] : IERC20(0);
        _token9 = tokens.length > 9 ? tokens[9] : IERC20(0);
        _token10 = tokens.length > 10 ? tokens[10] : IERC20(0);
        _token11 = tokens.length > 11 ? tokens[11] : IERC20(0);
        _token12 = tokens.length > 12 ? tokens[12] : IERC20(0);
        _token13 = tokens.length > 13 ? tokens[13] : IERC20(0);
        _token14 = tokens.length > 14 ? tokens[14] : IERC20(0);
        _token15 = tokens.length > 15 ? tokens[15] : IERC20(0);

        _scalingFactor0 = tokens.length > 0 ? _computeScalingFactor(tokens[0]) : 0;
        _scalingFactor1 = tokens.length > 1 ? _computeScalingFactor(tokens[1]) : 0;
        _scalingFactor2 = tokens.length > 2 ? _computeScalingFactor(tokens[2]) : 0;
        _scalingFactor3 = tokens.length > 3 ? _computeScalingFactor(tokens[3]) : 0;
        _scalingFactor4 = tokens.length > 4 ? _computeScalingFactor(tokens[4]) : 0;
        _scalingFactor5 = tokens.length > 5 ? _computeScalingFactor(tokens[5]) : 0;
        _scalingFactor6 = tokens.length > 6 ? _computeScalingFactor(tokens[6]) : 0;
        _scalingFactor7 = tokens.length > 7 ? _computeScalingFactor(tokens[7]) : 0;
        _scalingFactor8 = tokens.length > 8 ? _computeScalingFactor(tokens[8]) : 0;
        _scalingFactor9 = tokens.length > 9 ? _computeScalingFactor(tokens[9]) : 0;
        _scalingFactor10 = tokens.length > 10 ? _computeScalingFactor(tokens[10]) : 0;
        _scalingFactor11 = tokens.length > 11 ? _computeScalingFactor(tokens[11]) : 0;
        _scalingFactor12 = tokens.length > 12 ? _computeScalingFactor(tokens[12]) : 0;
        _scalingFactor13 = tokens.length > 13 ? _computeScalingFactor(tokens[13]) : 0;
        _scalingFactor14 = tokens.length > 14 ? _computeScalingFactor(tokens[14]) : 0;
        _scalingFactor15 = tokens.length > 15 ? _computeScalingFactor(tokens[15]) : 0;
    }

    // Getters / Setters

    function getVault() external view returns (IVault) {
        return _vault;
    }

    function getPoolId() external view returns (bytes32) {
        return _poolId;
    }

    function getSwapFee() external view returns (uint256) {
        return _swapFee;
    }

    function setSwapFee(uint256 swapFee) external authenticate {
        _require(swapFee <= _MAX_SWAP_FEE, Errors.MAX_SWAP_FEE);

        _swapFee = swapFee;
        emit SwapFeeChanged(swapFee);
    }

    function setEmergencyPeriod(bool active) external authenticate {
        _setEmergencyPeriod(active);
    }

    // Join / Exit Hooks

    modifier onlyVault(bytes32 poolId) {
        _require(msg.sender == address(_vault), Errors.CALLER_NOT_VAULT);
        _require(poolId == _poolId, Errors.INVALID_POOL_ID);
        _;
    }

    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256 latestBlockNumberUsed,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) external virtual override onlyVault(poolId) returns (uint256[] memory, uint256[] memory) {
        uint256[] memory scalingFactors = _scalingFactors();

        if (totalSupply() == 0) {
            (uint256 bptAmountOut, uint256[] memory amountsIn) = _onInitializePool(poolId, sender, recipient, userData);

            // On initialization, we lock _MINIMUM_BPT by minting it for the zero address. This BPT acts as a minimum
            // as it will never be burned, which reduces potential issues with rounding, and also prevents the Pool from
            // ever being fully drained.
            _require(bptAmountOut >= _MINIMUM_BPT, Errors.MINIMUM_BPT);
            _mintPoolTokens(address(0), _MINIMUM_BPT);
            _mintPoolTokens(recipient, bptAmountOut - _MINIMUM_BPT);

            // amountsIn are amounts entering the Pool, so we round up.
            _downscaleUpArray(amountsIn, scalingFactors);

            return (amountsIn, new uint256[](_totalTokens));
        } else {
            _upscaleArray(currentBalances, scalingFactors);
            (uint256 bptAmountOut, uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) = _onJoinPool(
                poolId,
                sender,
                recipient,
                currentBalances,
                latestBlockNumberUsed,
                protocolSwapFeePercentage,
                userData
            );

            // Note we no longer use `currentBalances` after calling `_onJoinPool`, which may mutate it.

            _mintPoolTokens(recipient, bptAmountOut);

            // amountsIn are amounts entering the Pool, so we round up.
            _downscaleUpArray(amountsIn, scalingFactors);
            // dueProtocolFeeAmounts are amounts exiting the Pool, so we round down.
            _downscaleDownArray(dueProtocolFeeAmounts, scalingFactors);

            return (amountsIn, dueProtocolFeeAmounts);
        }
    }

    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256 latestBlockNumberUsed,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) external virtual override onlyVault(poolId) returns (uint256[] memory, uint256[] memory) {
        uint256[] memory scalingFactors = _scalingFactors();
        _upscaleArray(currentBalances, scalingFactors);

        (uint256 bptAmountIn, uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) = _onExitPool(
            poolId,
            sender,
            recipient,
            currentBalances,
            latestBlockNumberUsed,
            protocolSwapFeePercentage,
            userData
        );

        // Note we no longer use `currentBalances` after calling `_onExitPool`, which may mutate it.

        _burnPoolTokens(sender, bptAmountIn);

        // Both amountsOut and dueProtocolFees are amounts exiting the Pool, so we round down.
        _downscaleDownArray(amountsOut, scalingFactors);
        _downscaleDownArray(dueProtocolFeeAmounts, scalingFactors);

        return (amountsOut, dueProtocolFeeAmounts);
    }

    // Query functions

    /**
     * @dev Returns the amount of BPT that would be granted to `recipient` if the `onJoinPool` hook was called by the
     * Vault with the same arguments, along with the number of tokens `sender` would have to supply.
     *
     * This function is not meant to be called directly, but rather from a helper contract that fetches current Vault
     * data such as the protocol swap fee and Pool balances.
     *
     * Like `IVault.queryBatchSwap`, this function is not view due to internal implementation details: the caller must
     * explicitly use eth_call instead of eth_sendTransaction.
     */
    function queryJoin(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256 latestBlockNumberUsed,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) external returns (uint256 bptOut, uint256[] memory amountsIn) {
        return
            _queryAction(
                poolId,
                sender,
                recipient,
                currentBalances,
                latestBlockNumberUsed,
                protocolSwapFeePercentage,
                userData,
                _onJoinPool,
                _downscaleUpArray
            );
    }

    /**
     * @dev Returns the amount of BPT that would be burned from `sender` if the `onExitPool` hook was called by the
     * Vault with the same arguments, along with the number of tokens `recipient` would receive.
     *
     * This function is not meant to be called directly, but rather from a helper contract that fetches current Vault
     * data such as the protocol swap fee and Pool balances.
     *
     * Like `IVault.queryBatchSwap`, this function is not view due to internal implementation details: the caller must
     * explicitly use eth_call instead of eth_sendTransaction.
     */
    function queryExit(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256 latestBlockNumberUsed,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) external returns (uint256 bptIn, uint256[] memory amountsOut) {
        return
            _queryAction(
                poolId,
                sender,
                recipient,
                currentBalances,
                latestBlockNumberUsed,
                protocolSwapFeePercentage,
                userData,
                _onExitPool,
                _downscaleDownArray
            );
    }

    // Internal hooks to be overridden by derived contracts - all token amounts (except BPT) in these interfaces are
    // upscaled.

    /**
     * @dev Called when the Pool is joined for the first time, that is, when the BPT total supply is zero.
     *
     * Returns the amount of BPT to mint, and the token amounts the Pool will receive in return.
     *
     * Minted BPT will be sent to `recipient`, except for _MINIMUM_BPT which will be deducted from this amount and sent
     * to the zero address instead. This will cause that BPT to remain forever locked there, preventing total BTP from
     * ever dropping below that value, and ensuring `_onInitializePool` can only be called once in the entire Pool's
     * lifetime.
     *
     * The tokens granted to the Pool will be transferred from `sender`. These amounts are considered upscaled and will
     * be downscaled (rounding up) before being returned to the Vault.
     */
    function _onInitializePool(
        bytes32 poolId,
        address sender,
        address recipient,
        bytes memory userData
    ) internal virtual returns (uint256 bptAmountOut, uint256[] memory amountsIn);

    /**
     * @dev Called whenever the Pool is joined, outside of the first initialization join (see `_onInitializePool`).
     *
     * Returns the amount of BPT to mint, the token amounts that the Pool will receive in
     * return, and the number of tokens to pay in the form of due protocol swap fees.
     *
     * Implementations of this function might choose to mutate the `currentBalances` array to save gas (e.g. when
     * performing intermediate calculations, such as subtraction of due protocol fees). This can be done safely.
     *
     * Minted BPT will be sent to `recipient`.
     *
     * The tokens granted to the Pool will be transferred from `sender`. These amounts are considered upscaled and will
     * be downscaled (rounding up) before being returned to the Vault.
     *
     * Due protocol swap fees will be taken from the Pool's balance in the Vault (see `IBasePool.onJoinPool`). These
     * amounts are considered upscaled and will be downscaled (rounding down) before being returned to the Vault.
     */
    function _onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256 latestBlockNumberUsed,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        internal
        virtual
        returns (
            uint256 bptAmountOut,
            uint256[] memory amountsIn,
            uint256[] memory dueProtocolFeeAmounts
        );

    /**
     * @dev Called whenever the Pool is exited.
     *
     * Returns the amount of BPT to burn, the token amounts for each Pool token that the Pool will grant in return, and
     * the number of tokens to pay in the form of due protocol swap fees.
     *
     * Implementations of this function might choose to mutate the `currentBalances` array to save gas (e.g. when
     * performing intermediate calculations, such as subtraction of due protocol fees). This can be done safely.
     *
     * BPT will be burnt from `sender`.
     *
     * The Pool will grant tokens to `recipient`. These amounts are considered upscaled and will  be downscaled
     * (rounding down) before being returned to the Vault.
     *
     * Due protocol swap fees will be taken from the Pool's balance in the Vault (see `IBasePool.onExitPool`). These
     * amounts are considered upscaled and will be downscaled (rounding down) before being returned to the Vault.
     */
    function _onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256 latestBlockNumberUsed,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        internal
        virtual
        returns (
            uint256 bptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory dueProtocolFeeAmounts
        );

    // Internal functions

    /**
     * @dev Adds swap fees to `amount`, returning a larger value.
     */
    function _addSwapFee(uint256 amount) internal view returns (uint256) {
        // This returns amount + fees, so we round up (favoring fees).
        return amount.divUp(_swapFee.complement());
    }

    /**
     * @dev Subtracts swap fees from `amount`, returning a lower value.
     */
    function _subtractSwapFee(uint256 amount) internal view returns (uint256) {
        // Round up, favoring fees.
        uint256 fees = amount.mulUp(_swapFee);
        return amount.sub(fees);
    }

    // Scaling

    /**
     * @dev Returns a scaling factor that, when multiplied to a token amount for `token`, normalizes its balance as if
     * it had 18 decimals.
     */
    function _computeScalingFactor(IERC20 token) private view returns (uint256) {
        // Tokens that don't implement the `decimals` method are not supported.
        uint256 tokenDecimals = ERC20(address(token)).decimals();

        // Tokens with more than 18 decimals are not supported.
        uint256 decimalsDifference = Math.sub(18, tokenDecimals);
        return 10**decimalsDifference;
    }

    /**
     * @dev Returns the scaling factor for one of the Pool's tokens. Reverts if `token` is not a token registered by the
     * Pool.
     */
    function _scalingFactor(IERC20 token) internal view returns (uint256) {
        // prettier-ignore
        if (token == _token0) { return _scalingFactor0; }
        else if (token == _token1) { return _scalingFactor1; }
        else if (token == _token2) { return _scalingFactor2; }
        else if (token == _token3) { return _scalingFactor3; }
        else if (token == _token4) { return _scalingFactor4; }
        else if (token == _token5) { return _scalingFactor5; }
        else if (token == _token6) { return _scalingFactor6; }
        else if (token == _token7) { return _scalingFactor7; }
        else if (token == _token8) { return _scalingFactor8; }
        else if (token == _token9) { return _scalingFactor9; }
        else if (token == _token10) { return _scalingFactor10; }
        else if (token == _token11) { return _scalingFactor11; }
        else if (token == _token12) { return _scalingFactor12; }
        else if (token == _token13) { return _scalingFactor13; }
        else if (token == _token14) { return _scalingFactor14; }
        else if (token == _token15) { return _scalingFactor15; }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    /**
     * @dev Returns all the scaling factors in the same order as tokens were registered, which is the order
     * the Vault will pass balances when calling the different Pool hooks.
     */
    function _scalingFactors() internal view returns (uint256[] memory) {
        uint256[] memory scalingFactors = new uint256[](_totalTokens);

        // prettier-ignore
        {
            if (_totalTokens > 0) { scalingFactors[0] = _scalingFactor0; } else { return scalingFactors; }
            if (_totalTokens > 1) { scalingFactors[1] = _scalingFactor1; } else { return scalingFactors; }
            if (_totalTokens > 2) { scalingFactors[2] = _scalingFactor2; } else { return scalingFactors; }
            if (_totalTokens > 3) { scalingFactors[3] = _scalingFactor3; } else { return scalingFactors; }
            if (_totalTokens > 4) { scalingFactors[4] = _scalingFactor4; } else { return scalingFactors; }
            if (_totalTokens > 5) { scalingFactors[5] = _scalingFactor5; } else { return scalingFactors; }
            if (_totalTokens > 6) { scalingFactors[6] = _scalingFactor6; } else { return scalingFactors; }
            if (_totalTokens > 7) { scalingFactors[7] = _scalingFactor7; } else { return scalingFactors; }
            if (_totalTokens > 8) { scalingFactors[8] = _scalingFactor8; } else { return scalingFactors; }
            if (_totalTokens > 9) { scalingFactors[9] = _scalingFactor9; } else { return scalingFactors; }
            if (_totalTokens > 10) { scalingFactors[10] = _scalingFactor10; } else { return scalingFactors; }
            if (_totalTokens > 11) { scalingFactors[11] = _scalingFactor11; } else { return scalingFactors; }
            if (_totalTokens > 12) { scalingFactors[12] = _scalingFactor12; } else { return scalingFactors; }
            if (_totalTokens > 13) { scalingFactors[13] = _scalingFactor13; } else { return scalingFactors; }
            if (_totalTokens > 14) { scalingFactors[14] = _scalingFactor14; } else { return scalingFactors; }
            if (_totalTokens > 15) { scalingFactors[15] = _scalingFactor15; } else { return scalingFactors; }
        }

        return scalingFactors;
    }

    /**
     * @dev Applies `scalingFactor` to `amount`, resulting in a larger or equal value depending on whether it needed
     * scaling or not.
     */
    function _upscale(uint256 amount, uint256 scalingFactor) internal pure returns (uint256) {
        return Math.mul(amount, scalingFactor);
    }

    /**
     * @dev Same as `_upscale`, but for an entire array. This function does not return anything, but instead *mutates*
     * the `amounts` array.
     */
    function _upscaleArray(uint256[] memory amounts, uint256[] memory scalingFactors) internal view {
        for (uint256 i = 0; i < _totalTokens; ++i) {
            amounts[i] = Math.mul(amounts[i], scalingFactors[i]);
        }
    }

    /**
     * @dev Deapplies `scalingFactor` to `amount`, resulting in a smaller or equal value depending on whether it needed
     * scaling or not. The result is rounded down.
     */
    function _downscaleDown(uint256 amount, uint256 scalingFactor) internal pure returns (uint256) {
        return Math.divDown(amount, scalingFactor);
    }

    /**
     * @dev Same as `_downscaleDown`, but for an entire array. This function does not return anything, but instead
     * *mutates* the `amounts` array.
     */
    function _downscaleDownArray(uint256[] memory amounts, uint256[] memory scalingFactors) internal view {
        for (uint256 i = 0; i < _totalTokens; ++i) {
            amounts[i] = Math.divDown(amounts[i], scalingFactors[i]);
        }
    }

    /**
     * @dev Deapplies `scalingFactor` to `amount`, resulting in a smaller or equal value depending on whether it needed
     * scaling or not. The result is rounded up.
     */
    function _downscaleUp(uint256 amount, uint256 scalingFactor) internal pure returns (uint256) {
        return Math.divUp(amount, scalingFactor);
    }

    /**
     * @dev Same as `_downscaleUp`, but for an entire array. This function does not return anything, but instead
     * *mutates* the `amounts` array.
     */
    function _downscaleUpArray(uint256[] memory amounts, uint256[] memory scalingFactors) internal view {
        for (uint256 i = 0; i < _totalTokens; ++i) {
            amounts[i] = Math.divUp(amounts[i], scalingFactors[i]);
        }
    }

    /**
     * @dev This contract relies on the roles defined by the Vault's own Authorizer.
     */
    function _getAuthorizer() internal view override returns (IAuthorizer) {
        return _vault.getAuthorizer();
    }

    function _queryAction(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256 latestBlockNumberUsed,
        uint256 protocolSwapFeePercentage,
        bytes memory userData,
        function(bytes32, address, address, uint256[] memory, uint256, uint256, bytes memory)
            internal
            returns (uint256, uint256[] memory, uint256[] memory) _action,
        function(uint256[] memory, uint256[] memory) internal view _downscaleArray
    ) private returns (uint256, uint256[] memory) {
        // This uses the same technique used by the Vault in queryBatchSwap. Refer to that function for a detailed
        // explanation.

        if (msg.sender != address(this)) {
            // We perform an external call to ourselves, forwarding the same calldata. In this call, the else clause of
            // the preceding if statement will be executed instead.

            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = address(this).call(msg.data);

            // solhint-disable-next-line no-inline-assembly
            assembly {
                // This call should always revert to decode the bpt and token amounts from the revert reason
                switch success
                    case 0 {
                        // Note we are manually writing the memory slot 0. We can safely overwrite whatever is
                        // stored there as we take full control of the execution and then immediately return.

                        // We copy the first 4 bytes to check if it matches with the expected signature, otherwise
                        // there was another revert reason and we should forward it.
                        returndatacopy(0, 0, 0x04)
                        let error := and(mload(0), 0xffffffff00000000000000000000000000000000000000000000000000000000)

                        // If the first 4 bytes don't match with the expected signature, we forward the revert reason.
                        if eq(eq(error, 0x43adbafb00000000000000000000000000000000000000000000000000000000), 0) {
                            returndatacopy(0, 0, returndatasize())
                            revert(0, returndatasize())
                        }

                        // The returndata contains the signature, followed by the raw memory representation of the
                        // `bptAmount` and `tokenAmounts` (array: length + data). We need to return an ABI-encoded
                        // representation of these.
                        // An ABI-encoded response will include one additional field to indicate the starting offset of
                        // the `tokenAmounts` array. The `bptAmount` will be laid out in the first word of the
                        // returndata.
                        //
                        // In returndata:
                        // [ signature ][ bptAmount ][ tokenAmounts length ][ tokenAmounts values ]
                        // [  4 bytes  ][  32 bytes ][       32 bytes      ][ (32 * length) bytes ]
                        //
                        // We now need to return (ABI-encoded values):
                        // [ bptAmount ][ tokeAmounts offset ][ tokenAmounts length ][ tokenAmounts values ]
                        // [  32 bytes ][       32 bytes     ][       32 bytes      ][ (32 * length) bytes ]

                        // We copy 32 bytes for the `bptAmount` from returndata into memory.
                        // Note that we skip the first 4 bytes for the error signature
                        returndatacopy(0, 0x04, 32)

                        // The offsets are 32-bytes long, so the array of `tokenAmounts` will start after
                        // the initial 64 bytes.
                        mstore(0x20, 64)

                        // We now copy the raw memory array for the `tokenAmounts` from returndata into memory.
                        // Since bpt amount and offset take up 64 bytes, we start copying at address 0x40. We also
                        // skip the first 36 bytes from returndata, which correspond to the signature plus bpt amount.
                        returndatacopy(0x40, 0x24, sub(returndatasize(), 36))

                        // We finally return the ABI-encoded uint256 and the array, which has a total length equal to
                        // the size of returndata, plus the 32 bytes of the offset but without the 4 bytes of the
                        // error signature.
                        return(0, add(returndatasize(), 28))
                    }
                    default {
                        // This call should always revert, but we fail nonetheless if that didn't happen
                        invalid()
                    }
            }
        } else {
            uint256[] memory scalingFactors = _scalingFactors();
            _upscaleArray(currentBalances, scalingFactors);

            (uint256 bptAmount, uint256[] memory tokenAmounts, ) = _action(
                poolId,
                sender,
                recipient,
                currentBalances,
                latestBlockNumberUsed,
                protocolSwapFeePercentage,
                userData
            );

            _downscaleArray(tokenAmounts, scalingFactors);

            // solhint-disable-next-line no-inline-assembly
            assembly {
                // We will return a raw representation of `bptAmount` and `tokenAmounts` in memory, which is composed of
                // a 32-byte uint256, followed by a 32-byte for the array length, and finally the 32-byte uint256 values
                // Because revert expects a size in bytes, we multiply the array length (stored at `tokenAmounts`) by 32
                let size := mul(mload(tokenAmounts), 32)

                // We store the `bptAmount` in the previous slot to the `tokenAmounts` array. We can make sure there
                // will be at least one available slot due to how the memory scratch space works.
                // We can safely overwrite whatever is stored in this slot as we will revert immediately after that.
                let start := sub(tokenAmounts, 0x20)
                mstore(start, bptAmount)

                // We send one extra value for the error signature "QueryError(uint256,uint256[])" which is 0x43adbafb
                // We use the previous slot to `bptAmount`.
                mstore(sub(start, 0x20), 0x0000000000000000000000000000000000000000000000000000000043adbafb)
                start := sub(start, 0x04)

                // When copying from `tokenAmounts` into returndata, we copy the additional 68 bytes to also return
                // the `bptAmount`, the array 's length, and the error signature.
                revert(start, add(size, 68))
            }
        }
    }
}
