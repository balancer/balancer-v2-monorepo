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

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../lib/math/FixedPoint.sol";
import "../lib/helpers/InputHelpers.sol";

import "./BalancerPoolToken.sol";
import "./BasePoolAuthorization.sol";
import "../vault/interfaces/IVault.sol";
import "../vault/interfaces/IBasePool.sol";
import "../lib/helpers/EmergencyPeriod.sol";

// This contract relies on tons of immutable state variables to
// perform efficient lookup, without resorting to storage reads.
// solhint-disable max-states-count

/**
 * @dev Reference implementation for the base layer of a Pool contract that manges a single Pool with an immutable set
 * of registered tokens, no Asset Managers, and an immutable swap fee.
 *
 * Because this contract doesn't implement the swap hooks, derived contracts should likely inherit from BaseGeneralPool
 * or BaseMinimalSwapInfoPool instead.
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

    // Scaling factors for each token
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

    constructor(
        IVault vault,
        IVault.PoolSpecialization specialization,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 swapFee,
        uint256 emergencyPeriod,
        uint256 emergencyPeriodCheckExtension
    )
        BasePoolAuthorization()
        BalancerPoolToken(name, symbol)
        EmergencyPeriod(emergencyPeriod, emergencyPeriodCheckExtension)
    {
        require(tokens.length >= _MIN_TOKENS, "MIN_TOKENS");
        require(tokens.length <= _MAX_TOKENS, "MAX_TOKENS");

        // The Vault only requires the token list to be ordered for the Two Token Pools specialization. However,
        // to make the developer experience consistent, we are requiring this condition for all the native pools.
        // Also, since these Pools will register tokens only once, we can ensure the Pool tokens will follow the same
        // order. We rely on this property to make Pools simpler to write, as it lets us assume that the
        // order of token-specific parameters (such as token weights) will not change.
        InputHelpers.ensureArrayIsSorted(tokens);

        require(swapFee <= _MAX_SWAP_FEE, "MAX_SWAP_FEE");

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

    function getVault() external view override returns (IVault) {
        return _vault;
    }

    function getPoolId() external view override returns (bytes32) {
        return _poolId;
    }

    function getSwapFee() external view returns (uint256) {
        return _swapFee;
    }

    function setSwapFee(uint256 swapFee) external authenticate {
        require(swapFee <= _MAX_SWAP_FEE, "MAX_SWAP_FEE");
        _swapFee = swapFee;
    }

    function setEmergencyPeriod(bool active) external authenticate {
        _setEmergencyPeriod(active);
    }

    // Join / Exit Hooks

    modifier onlyVault(bytes32 poolId) {
        require(msg.sender == address(_vault), "CALLER_NOT_VAULT");
        require(poolId == _poolId, "INVALID_POOL_ID");
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
    ) external override onlyVault(poolId) returns (uint256[] memory, uint256[] memory) {
        uint256[] memory scalingFactors = _scalingFactors();
        _upscaleArray(currentBalances, scalingFactors);

        if (totalSupply() == 0) {
            (uint256 bptAmountOut, uint256[] memory amountsIn) = _onInitializePool(poolId, sender, recipient, userData);

            // On initialization, we lock _MINIMUM_BPT by minting it for the zero address. This BPT acts as a minimum
            // as it will never be burned, which reduces potential issues with rounding, and also prevents the Pool from
            // ever being fully drained.
            require(bptAmountOut >= _MINIMUM_BPT, "MINIMUM_BPT");
            _mintPoolTokens(address(0), _MINIMUM_BPT);
            _mintPoolTokens(recipient, bptAmountOut - _MINIMUM_BPT);

            // amountsIn are amounts entering the Pool, so we round up.
            _downscaleUpArray(amountsIn, scalingFactors);

            return (amountsIn, new uint256[](_totalTokens));
        } else {
            (uint256 bptAmountOut, uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) = _onJoinPool(
                poolId,
                sender,
                recipient,
                currentBalances,
                latestBlockNumberUsed,
                protocolSwapFeePercentage,
                userData
            );

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
    ) external override onlyVault(poolId) returns (uint256[] memory, uint256[] memory) {
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

        _burnPoolTokens(sender, bptAmountIn);

        // Both amountsOut and dueProtocolFees are amounts exiting the Pool, so we round down.
        _downscaleDownArray(amountsOut, scalingFactors);
        _downscaleDownArray(dueProtocolFeeAmounts, scalingFactors);

        return (amountsOut, dueProtocolFeeAmounts);
    }

    function _onInitializePool(
        bytes32 poolId,
        address sender,
        address recipient,
        bytes memory userData
    ) internal virtual returns (uint256, uint256[] memory);

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
            uint256,
            uint256[] memory,
            uint256[] memory
        );

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
            uint256,
            uint256[] memory,
            uint256[] memory
        );

    function _addSwapFee(uint256 amount) internal view returns (uint256) {
        // This returns amount + fees, so we round up (favoring fees).
        return amount.divUp(_swapFee.complement());
    }

    function _subtractSwapFee(uint256 amount) internal view returns (uint256) {
        // Round up, favoring fees.
        uint256 fees = amount.mulUp(_swapFee);
        return amount.sub(fees);
    }

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
            revert("INVALID_TOKEN");
        }
    }

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

    function _upscale(uint256 amount, uint256 scalingFactor) internal pure returns (uint256) {
        return Math.mul(amount, scalingFactor);
    }

    function _upscaleArray(uint256[] memory amount, uint256[] memory scalingFactors) internal view {
        for (uint256 i = 0; i < _totalTokens; ++i) {
            amount[i] = Math.mul(amount[i], scalingFactors[i]);
        }
    }

    function _downscaleDown(uint256 amount, uint256 scalingFactor) internal pure returns (uint256) {
        return Math.divDown(amount, scalingFactor);
    }

    function _downscaleDownArray(uint256[] memory amount, uint256[] memory scalingFactors) internal view {
        for (uint256 i = 0; i < _totalTokens; ++i) {
            amount[i] = Math.divDown(amount[i], scalingFactors[i]);
        }
    }

    function _downscaleUp(uint256 amount, uint256 scalingFactor) internal pure returns (uint256) {
        return Math.divUp(amount, scalingFactor);
    }

    function _downscaleUpArray(uint256[] memory amount, uint256[] memory scalingFactors) internal view {
        for (uint256 i = 0; i < _totalTokens; ++i) {
            amount[i] = Math.divUp(amount[i], scalingFactors[i]);
        }
    }

    function _getAuthorizer() internal view override returns (IAuthorizer) {
        return _vault.getAuthorizer();
    }
}
