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

// Needed for struct arguments
pragma experimental ABIEncoderV2;

// Imports

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../math/FixedPoint.sol";

import "./Settings.sol";

// Contracts

/**
 * @title Moves tokens in and out of the Vault
 * @author Balancer Labs
 */
abstract contract VaultAccounting is Settings {
    using FixedPoint for uint256;
    using FixedPoint for uint128;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    // Function declarations

    // External functions

    /**
     * @notice Returns the amount of protocol fees collected for a specific token
     * @param token - the token we've collected fees on
     * @return total fee balance collected for the given token
     */
    function getCollectedFeesByToken(IERC20 token) external view override returns (uint256) {
        return _collectedProtocolFees[token];
    }

    // Internal functions

    /**
     * @notice Transfers tokens into the Vault from the "from" address.
     *         The caller must verify that this action was authorized by "from" (typically the entry-point function
     *         is called by an agent for "from").
     *
     *         Return the number of tokens received
     * @param token - the token being transferred
     * @param from - the source address
     * @param amount - the amount being added to the vault
     */
    function _pullTokens(
        IERC20 token,
        address from,
        uint128 amount
    )
        internal
        returns (uint128)
    {
        if (amount == 0) {
            return 0;
        }

        uint256 currentBalance = token.balanceOf(address(this));

        token.safeTransferFrom(from, address(this), amount);

        uint256 newBalance = token.balanceOf(address(this));

        return newBalance.sub(currentBalance).toUint128();
    }

    /**
     * @notice Transfers tokens out of the Vault, to the "to" address.
     *         The caller must verify that this action was authorized by "to" (typically the entry-point function
     *         is called by an agent for "to").
     * @param token - the token being transferred
     * @param to - the destination address
     * @param amount - the amount being withdrawn from the vault
     * @param chargeFee - flag; if set, charge a protocol withdrawal fee
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
