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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/ISilo.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IShareToken.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title SiloWrapping
 * @notice Allows users to wrap and unwrap Silo shareTokens
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract SiloWrapping is IBaseRelayerLibrary {
    using Address for address payable;
    using SafeERC20 for IERC20;

    function wrapShareToken(
        IShareToken wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        // Initialize the token we will be wrapping (underlying asset of shareToken)
        IERC20 underlyingToken = IERC20(wrappedToken.asset());
        // Initialize the corresponding Silo (Liquidity Pool)
        ISilo silo = wrappedToken.silo();

        // The wrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, underlyingToken, amount);
        }

        underlyingToken.safeApprove(address(silo), amount);

        // the collateralOnly param is set to false because we want to receive interest bearing shareTokens
        (, uint256 result) = silo.depositFor(address(underlyingToken), recipient, amount, false);

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, result);
        }
    }

    function unwrapShareToken(
        IShareToken wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }
        // Initialize the token we will be withdrawing
        IERC20 underlyingToken = IERC20(wrappedToken.asset());
        // Initialize the corresponding Silo (Liquidity Pool)
        ISilo silo = wrappedToken.silo();

        // The wrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first them pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, wrappedToken, amount);
        }

        // No approval is needed here, as the shareTokens are burned directly from the relayer's account.
        // Setting the amount to uint256(-1) informs Silo that we'd like to redeem all the relayer's shares.
        // Ignore the return value which cannot be trusted. It does not include any fees assessed.
        silo.withdraw(address(underlyingToken), uint256(-1), false);

        uint256 result = underlyingToken.balanceOf(address(this));
        if (recipient != address(this)) {
            underlyingToken.safeTransfer(recipient, result);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, result);
        }
    }
}
