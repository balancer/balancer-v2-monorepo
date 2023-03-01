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

import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";

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

    /**
     * @dev Euler protocol needs to be approved to transer mainToken
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

        uint256 withdrawnWrappedAmount = wrappedToken.balanceOf(address(this));

        if (recipient != address(this)) {
            IERC20(wrappedToken).safeApprove(address(this), withdrawnWrappedAmount);
            IERC20(wrappedToken).safeTransferFrom(address(this), recipient, withdrawnWrappedAmount);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, withdrawnWrappedAmount);
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
            _pullToken(sender, IERC20(address(wrappedToken)), amount);
        }

        IERC20 mainToken = IERC20(wrappedToken.underlyingAsset());

        // Euler offers two ways to withdraw. Either calculate the MainTokenOut via
        // 1. MainTokenOut = wrappedToken.convertBalanceToUnderlying(WrappedTokenAmount); or
        // 2. withdraw as Much MainToken as one gets when depositing WrappedTokenAmount back
        // When using option 1, the possibility exists to have dust of WrappedToken in the relayer
        // Therefor option 2 is chosen
        // 0 for the Euler primary account
        wrappedToken.withdraw(0, uint256(-1)); //MAX_UINT forces option 2

        uint256 withdrawnMainAmount = mainToken.balanceOf(address(this));

        if (recipient != address(this)) {
            mainToken.safeApprove(address(this), withdrawnMainAmount);
            mainToken.safeTransferFrom(address(this), recipient, withdrawnMainAmount);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, withdrawnMainAmount);
        }
    }
}
