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

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "../lib/math/FixedPoint.sol";

import "./BalancerPoolToken.sol";
import "../vault/interfaces/IVault.sol";
import "../vault/interfaces/IBasePool.sol";

abstract contract BasePool is IBasePool, BalancerPoolToken {
    using Math for uint256;
    using FixedPoint for uint256;

    uint256 private constant _MIN_TOKENS = 2;
    uint256 private constant _MAX_TOKENS = 16;

    uint256 private constant _MAX_SWAP_FEE = 10 * (10**16); // 10%

    IVault internal immutable _vault;
    bytes32 internal immutable _poolId;
    uint256 internal immutable _swapFee;

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

    constructor(
        IVault vault,
        IVault.PoolSpecialization specialization,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 swapFee
    ) BalancerPoolToken(name, symbol) {
        require(tokens.length >= _MIN_TOKENS, "MIN_TOKENS");
        require(tokens.length <= _MAX_TOKENS, "MAX_TOKENS");

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
    }

    // Getters

    function getVault() external view override returns (IVault) {
        return _vault;
    }

    function getPoolId() external view override returns (bytes32) {
        return _poolId;
    }

    function getSwapFee() external view returns (uint256) {
        return _swapFee;
    }

    // Join / Exit Hooks

    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256 latestBlockNumberUsed,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) external override returns (uint256[] memory, uint256[] memory) {
        require(msg.sender == address(_vault), "CALLER_NOT_VAULT");
        require(poolId == _poolId, "INVALID_POOL_ID");

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

        return (amountsIn, dueProtocolFeeAmounts);
    }

    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory currentBalances,
        uint256 latestBlockNumberUsed,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) external override returns (uint256[] memory, uint256[] memory) {
        require(msg.sender == address(_vault), "CALLER_NOT_VAULT");
        require(poolId == _poolId, "INVALID_POOL_ID");

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

        return (amountsOut, dueProtocolFeeAmounts);
    }

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
        return amount.divUp(FixedPoint.ONE.sub(_swapFee));
    }

    function _subtractSwapFee(uint256 amount) internal view returns (uint256) {
        // Round up, favoring fees.
        uint256 fees = amount.mulUp(_swapFee);
        return amount.sub(fees);
    }
}
