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
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";

import "./BNum.sol";
import "./math/FixedPoint.sol";

library BalanceLib {
    struct Balance {
        uint128 cash;
        uint128 invested;
    }

    function total(Balance storage self) internal view returns (uint128) {
        return self.cash + self.invested;
    }
}

contract VaultAccounting is BNum {
    using BalanceLib for BalanceLib.Balance;
    using FixedPoint for uint256;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    // The vault's accounted-for balance for each token. These include:
    //  * tokens in pools
    //  * tokens stored as user balance
    mapping(address => BalanceLib.Balance) internal _vaultTokenBalance; // token -> vault balance

    // Returns the amount of tokens that were actually received
    function _pullTokens(
        address token,
        address from,
        uint128 amount
    ) internal returns (uint128) {
        uint256 currentBalance = IERC20(token).balanceOf(address(this));

        IERC20(token).safeTransferFrom(from, address(this), amount);

        uint256 newBalance = IERC20(token).balanceOf(address(this));

        uint128 received = newBalance.sub(currentBalance).toUint128();
        _vaultTokenBalance[token].cash += received;

        return received;
    }

    function _sendTokens(
        address token,
        address to,
        uint128 amount
    ) internal {
        _vaultTokenBalance[token].cash -= amount;
        IERC20(token).transfer(to, amount);
    }
}
