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

import "./Settings.sol";

abstract contract VaultAccounting is Settings {
    using FixedPoint for uint256;
    using FixedPoint for uint128;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    //Protocol Fees
    /**
     * @dev Returns the amount in protocol fees collected for a specific `token`.
     */
    function getCollectedFeesByToken(IERC20 token) external view override returns (uint256) {
        return _collectedProtocolFees[token];
    }

    /**
     * @dev Transfers tokens into the Vault from `from`. The caller must verify that this action was authorized by
     * `from` (typically by the entry-point function being called by an agent for `from`).
     */
    function _pullTokens(
        IERC20 token,
        address from,
        uint128 amount
    ) internal {
        if (amount != 0) {
            token.safeTransferFrom(from, address(this), amount);
        }
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

        if (chargeFee) {
            //Collects withdrawal fee
            uint128 fee = _calculateProtocolWithdrawFee(amount);
            _collectedProtocolFees[token] = _collectedProtocolFees[token].add(fee);

            token.safeTransfer(to, amount.sub128(fee));
        } else {
            token.safeTransfer(to, amount);
        }
    }
}
