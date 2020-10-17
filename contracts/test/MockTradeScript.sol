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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../ISwapCaller.sol";
import "../IVault.sol";

contract MockTradeScript is ISwapCaller {
    function batchSwap(
        IVault vault,
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        IVault.Diff[] calldata diffs,
        IVault.Swap[] calldata swaps,
        address recipient,
        bool useUserBalance
    ) external {
        require(
            tokens.length == amounts.length,
            "MockTradeScript: tokens & amounts length mismatch"
        );

        bytes memory callbackData = abi.encode(
            vault,
            msg.sender,
            tokens,
            amounts
        );

        vault.batchSwap(diffs, swaps, recipient, useUserBalance, callbackData);
    }

    function sendTokens(bytes calldata callbackData) external override {
        (
            address vault,
            address sender,
            address[] memory tokens,
            uint256[] memory amounts
        ) = abi.decode(callbackData, (address, address, address[], uint256[]));

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20(tokens[i]).transferFrom(sender, vault, amounts[i]);
        }
    }
}
