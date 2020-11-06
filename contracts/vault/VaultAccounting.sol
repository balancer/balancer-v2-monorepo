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

import "../math/FixedPoint.sol";

import "./IVault.sol";
import "./Settings.sol";

library BalanceLib {
    using FixedPoint for uint128;

    struct Balance {
        uint128 cash;
        uint128 total;
    }

    function invested(Balance memory self) internal pure returns (uint128) {
        return self.total - self.cash;
    }

    function increase(Balance memory self, uint128 amount)
        internal
        pure
        returns (Balance memory)
    {
        return
            Balance({
                cash: self.cash.add128(amount),
                total: self.total.add128(amount)
            });
    }

    function decrease(Balance memory self, uint128 amount)
        internal
        pure
        returns (Balance memory)
    {
        return
            Balance({
                cash: self.cash.sub128(amount),
                total: self.total.sub128(amount)
            });
    }
}

abstract contract VaultAccounting is IVault, Settings {
    using BalanceLib for BalanceLib.Balance;
    using FixedPoint for uint256;
    using FixedPoint for uint128;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    // The vault's accounted-for balance for each token. These include:
    //  * tokens in pools
    //  * tokens stored as user balance
    mapping(address => BalanceLib.Balance) internal _vaultTokenBalance; // token -> vault balance

    function getTotalUnaccountedForTokens(address token)
        public
        view
        override
        returns (uint256)
    {
        uint256 totalBalance = IERC20(token).balanceOf(address(this));
        assert(totalBalance >= _vaultTokenBalance[token].cash);

        return totalBalance - _vaultTokenBalance[token].cash;
    }

    // Returns the amount of tokens that were actually received
    function _pullTokens(
        address token,
        address from,
        uint128 amount
    ) internal returns (uint128) {
        if (amount == 0) {
            return 0;
        }

        uint256 currentBalance = IERC20(token).balanceOf(address(this));

        IERC20(token).safeTransferFrom(from, address(this), amount);

        uint256 newBalance = IERC20(token).balanceOf(address(this));

        uint128 received = newBalance.sub(currentBalance).toUint128();

        _vaultTokenBalance[token] = _vaultTokenBalance[token].increase(
            received
        );

        return received;
    }

    function _pushTokens(
        address token,
        address to,
        uint128 amount,
        bool chargeFee
    ) internal {
        if (amount == 0) {
            return;
        }

        _vaultTokenBalance[token] = _vaultTokenBalance[token].decrease(amount);

        uint128 amountToSend = chargeFee
            ? _applyProtocolWithdrawFee(amount)
            : amount;

        IERC20(token).safeTransfer(to, amountToSend);
    }
}
