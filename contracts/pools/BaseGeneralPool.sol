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

import "./BasePool.sol";
import "../vault/interfaces/IGeneralPool.sol";

abstract contract BaseGeneralPool is IGeneralPool, BasePool {
    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 swapFee
    ) BasePool(vault, IVault.PoolSpecialization.GENERAL, name, symbol, tokens, swapFee) {}

    // Swap Hooks

    function onSwapGivenIn(
        IPoolSwapStructs.SwapRequestGivenIn memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external override returns (uint256) {
        swapRequest.amountIn = _subtractSwapFee(swapRequest.amountIn);
        return _onSwapGivenIn(swapRequest, balances, indexIn, indexOut);
    }

    function onSwapGivenOut(
        IPoolSwapStructs.SwapRequestGivenOut memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external override returns (uint256) {
        uint256 amountIn = _onSwapGivenOut(swapRequest, balances, indexIn, indexOut);
        return _addSwapFee(amountIn);
    }

    function _onSwapGivenIn(
        IPoolSwapStructs.SwapRequestGivenIn memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual returns (uint256);

    function _onSwapGivenOut(
        IPoolSwapStructs.SwapRequestGivenOut memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual returns (uint256);
}
