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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IEulerToken.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title EulerWrapping
 * @notice Allows users to wrap and unwrap Euler tokens
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract EulerWrapping is IBaseRelayerLibrary {
    using Address for address payable;
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    address private immutable _eulerProtocol;
    //solhint-disable-next-line private-vars-leading-underscore
    uint256 private constant MAX_UINT256 = type(uint256).max;

    /**
     * @dev Euler protocol needs to be approved to transfer mainToken
     * @param eulerProtocol - the address of the euler protocol
     */
    constructor(address eulerProtocol) {
        _eulerProtocol = eulerProtocol;
    }

    function wrapEuler(
        IEulerToken wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        IERC20 underlying = IERC20(wrappedToken.underlyingAsset());

        // The wrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, underlying, amount);
        }

        underlying.safeApprove(_eulerProtocol, amount);

        // Deposit MainToken into EulerToken
        // 0 for the Euler primary account
        wrappedToken.deposit(0, amount);

        uint256 receivedWrappedAmount = wrappedToken.balanceOf(address(this));

        if (recipient != address(this)) {
            IERC20(wrappedToken).safeTransfer(recipient, receivedWrappedAmount);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, receivedWrappedAmount);
        }
    }

    function unwrapEuler(
        IEulerToken wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        // The unwrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, wrappedToken, amount);
        }

        IERC20 mainToken = IERC20(wrappedToken.underlyingAsset());

        // Euler offers two ways to withdraw:
        //     1. Calculate mainTokenOut via wrappedToken.convertBalanceToUnderlying(wrappedTokenAmount)
        //     2. Redeem the account's full balance of wrappedToken for mainToken
        // Option 1 may leave wrappedToken dust in the relayer, so we choose option 2
        // The 0 argument is for the Euler primary account
        wrappedToken.withdraw(0, MAX_UINT256); //MAX_UINT256 forces option 2

        uint256 withdrawnMainAmount = mainToken.balanceOf(address(this));

        if (recipient != address(this)) {
            mainToken.safeTransfer(recipient, withdrawnMainAmount);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, withdrawnMainAmount);
        }
    }
}
