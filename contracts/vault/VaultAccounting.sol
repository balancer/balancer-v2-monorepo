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
import "./PoolBalance.sol";

abstract contract VaultAccounting is IVault, Settings {
    using PoolBalance for bytes32;
    using FixedPoint for uint256;
    using FixedPoint for uint128;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    /**
     * @dev Transfers tokens into the Vault from `from`. The caller must verify that this action was authorized by
     * `from` (typically by the entry-point function being called by an operator for `from`).
     *
     * The number of tokens received are measured as a delta, by calling `IERC20.balanceOf` before and after the
     * transfer. This means tokens with a transfer fee are supported. The number of tokens received is returned.
     */
    function _pullTokens(
        IERC20 token,
        address from,
        uint128 amount
    ) internal returns (uint128) {
        if (amount == 0) {
            return 0;
        }

        uint256 currentBalance = token.balanceOf(address(this));

        token.safeTransferFrom(from, address(this), amount);

        uint256 newBalance = token.balanceOf(address(this));

        return newBalance.sub(currentBalance).toUint128();
    }

    /**
     * @dev Transfers tokens from the Vault to `to`. If `chargeFee` is true, a withdrawal fee will be collected.
     */
    function _pushTokens(
        IERC20 token,
        address to,
        uint128 amount,
        bool chargeFee
    ) internal {
        if (amount == 0) {
            return;
        }
        uint128 amountToSend = chargeFee ? _applyProtocolWithdrawFee(amount) : amount;

        token.safeTransfer(to, amountToSend);
    }
}
