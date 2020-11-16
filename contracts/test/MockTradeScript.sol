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

import "../vault/IVault.sol";

contract MockTradeScript {
    function batchSwap(
        IVault vault,
        uint128[] memory amounts,
        IVault.SwapIn[] memory swaps,
        IERC20[] memory tokens,
        address supplier,
        address recipient,
        bool withdrawTokens
    ) public {
        require(tokens.length == amounts.length, "MockTradeScript: tokens & amounts length mismatch");

        vault.batchSwap(
            swaps,
            tokens,
            IVault.FundsIn({ withdrawFrom: supplier, amounts: amounts }),
            IVault.FundsOut({ recipient: recipient, transferToRecipient: withdrawTokens })
        );
    }
}
