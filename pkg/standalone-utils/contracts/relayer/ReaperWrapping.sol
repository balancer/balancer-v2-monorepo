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

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IReaperTokenVault.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title ReaperWrapping
 * @notice Allows users to wrap and unwrap Reapers's rfTokens into their underlying main tokens
 * @dev All functions must be payable so that it can be called as part of a multicall involving ETH
 */
abstract contract ReaperWrapping is IBaseRelayerLibrary {
    function unwrapReaperVaultToken(
        IReaperTokenVault vaultToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        amount = _resolveAmountAndPullToken(vaultToken, amount, sender);

        // Burn the rf shares and receive the underlying token.
        vaultToken.withdraw(amount);

        IERC20 underlyingToken = IERC20(vaultToken.token());
        // Determine the amount of underlying returned for the shares burned.
        uint256 withdrawnAmount = underlyingToken.balanceOf(address(this));

        _transferAndSetChainedReference(underlyingToken, recipient, withdrawnAmount, outputReference);
    }

    function wrapReaperVaultToken(
        IReaperTokenVault vaultToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        IERC20 underlyingToken = IERC20(vaultToken.token());

        amount = _resolveAmountPullTokenAndApproveSpender(underlyingToken, address(vaultToken), amount, sender);

        // Deposit the tokens into the vault
        vaultToken.deposit(amount);

        // Determine the amount of shares gained from depositing
        uint256 sharesGained = vaultToken.balanceOf(address(this));

        _transferAndSetChainedReference(vaultToken, recipient, sharesGained, outputReference);
    }
}
