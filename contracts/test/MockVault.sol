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
import "../vault/interfaces/IPoolJoinExit.sol";

contract MockVault {
    uint256[] private _currentBalances;
    IERC20[] private _tokens;

    function getPoolTokens(bytes32) external view returns (IERC20[] memory) {
        return _tokens;
    }

    function getPoolCurrentBalances() external view returns (uint256[] memory) {
        return _currentBalances;
    }

    function registerPool(IVault.PoolSpecialization) external view returns (bytes32) {
        return bytes32(uint256(msg.sender) << 96); //poolId
    }

    function registerTokens(
        bytes32,
        IERC20[] calldata tokens,
        address[] calldata
    ) external {
        for (uint256 i = 0; i < tokens.length; ++i) {
            _tokens.push(tokens[i]);
            _currentBalances.push(0);
        }
    }

    function joinPool(
        address poolAddress,
        bytes32 poolId,
        address recipient,
        IERC20[] memory,
        uint256[] memory maxAmountsIn,
        bool,
        bytes memory userData
    ) external {
        (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) = IPoolJoinExit(poolAddress).onJoinPool(
            poolId,
            _currentBalances,
            msg.sender,
            recipient,
            maxAmountsIn,
            0, //ProtocolFeePercentage
            userData
        );
        for (uint8 i = 0; i < _currentBalances.length; i++) {
            _currentBalances[i] = _currentBalances[i] + amountsIn[i] - dueProtocolFeeAmounts[i];
        }
    }

    function exitPool(
        address poolAddress,
        bytes32 poolId,
        address recipient,
        IERC20[] memory,
        uint256[] memory maxAmountsIn,
        bool,
        bytes memory userData
    ) external {
        (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) = IPoolJoinExit(poolAddress).onExitPool(
            poolId,
            _currentBalances,
            msg.sender,
            recipient,
            maxAmountsIn,
            0, //ProtocolFeePercentage
            userData
        );
        for (uint8 i = 0; i < _currentBalances.length; i++) {
            _currentBalances[i] = _currentBalances[i] - amountsOut[i] - dueProtocolFeeAmounts[i];
        }
    }
}
