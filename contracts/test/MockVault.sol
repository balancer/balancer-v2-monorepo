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

import "../vault/interfaces/IVault.sol";
import "../vault/interfaces/IPool.sol";

interface IMockPool {
    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] calldata currentBalances,
        uint256[] calldata maxAmountsIn,
        uint256 protocolSwapFee,
        bytes calldata userData
    ) external returns (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts);

    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] calldata currentBalances,
        uint256[] calldata minAmountsOut,
        uint256 protocolSwapFee,
        bytes calldata userData
    ) external returns (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts);
}

contract MockVault {
    event PoolJoined(uint256[] amountsIn, uint256[] dueProtocolFeeAmounts);
    event PoolExited(uint256[] amountsOut, uint256[] dueProtocolFeeAmounts);

    function registerPool(IVault.PoolOptimization) external view returns (bytes32) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function registerTokens(bytes32, IERC20[] calldata tokens) external {
        // solhint-disable-previous-line no-empty-blocks
    }

    function addLiquidity(
        bytes32,
        address,
        IERC20[] calldata,
        uint256[] calldata,
        bool
    ) external {
        // solhint-disable-previous-line no-empty-blocks
    }

    function joinPool(
        address poolAddress,
        bytes32 poolId,
        address recipient,
        uint256[] memory currentBalances,
        uint256[] memory maxAmountsIn,
        uint256 protocolFeePercentage,
        bytes memory userData
    ) external {
        (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) = IMockPool(poolAddress).onJoinPool(
            poolId,
            msg.sender,
            recipient,
            currentBalances,
            maxAmountsIn,
            protocolFeePercentage,
            userData
        );
        emit PoolJoined(amountsIn, dueProtocolFeeAmounts);
    }

    function exitPool(
        address poolAddress,
        bytes32 poolId,
        address recipient,
        uint256[] memory currentBalances,
        uint256[] memory minAmountsOut,
        uint256 protocolFeePercentage,
        bytes memory userData
    ) external {
        (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) = IPool(poolAddress).onExitPool(
            poolId,
            msg.sender,
            recipient,
            currentBalances,
            minAmountsOut,
            protocolFeePercentage,
            userData
        );
        emit PoolExited(amountsOut, dueProtocolFeeAmounts);
    }
}
