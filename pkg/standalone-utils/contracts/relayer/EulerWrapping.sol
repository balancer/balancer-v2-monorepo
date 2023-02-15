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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";

import "./IBaseRelayerLibrary.sol";
import "./interfaces/IMockEulerToken.sol";

import "hardhat/console.sol";

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

        // calculated balances of the wrappedToken in the Relayer
        IERC20 wrappedTokenErc20 = IERC20(address(wrappedToken));
        // uint256 wrappedAmountBefore = wrappedTokenErc20.balanceOf(address(this));

        console.log("WRAP: Relayer has amount of mainToken", underlying.balanceOf(address(this)));
        console.log("WRAP: Relayer wants to deposit amount of mainToken", amount);

        // Deposit MainToken into EulerToken
        // 0 for the Euler primary account
        wrappedToken.deposit(0, amount);

        // uint256 wrappedAmountAfter = wrappedTokenErc20.balanceOf(address(this));

        // @notice Convert an underlying amount to an eToken balance, taking into account current exchange rate
        // @param underlyingAmount Amount in underlying units (same decimals as underlying token)
        // @return eToken balance, in internal book-keeping units (18 decimals)
        // https://github.com/euler-xyz/euler-contracts/blob/master/contracts/modules/EToken.sol#L117
        
        // TODO: Is this call more efficient from a gas & precision perspective? 
        uint256 withdrawnWrappedAmount = wrappedToken.convertUnderlyingToBalance(amount);
        console.log("WRAP: Relayer has amount of wrappedToken", wrappedTokenErc20.balanceOf(address(this)));
        console.log("WRAP: Relayer expected to receive amount of wrappedToken", withdrawnWrappedAmount);

        console.log("WRAP");

        if (recipient != address(this)) {
            wrappedTokenErc20.safeApprove(address(this), withdrawnWrappedAmount);
            wrappedTokenErc20.safeTransferFrom(address(this), recipient, withdrawnWrappedAmount);
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

        // TODO: Delete next 2 lines after design decision has been taken
        IERC20 mainToken = IERC20(wrappedToken.underlyingAsset());
        // uint256 mainAmountBefore = mainToken.balanceOf(address(this));

        // Euler offers two ways to withdraw. Either calculate the MainTokenOut via
        // 1. MainTokenOut = wrappedToken.convertBalanceToUnderlying(WrappedTokenAmount); or
        // 2. withdraw as Much MainToken as one gets when depositing WrappedTokenAmount back
        // When using option 1, the possibility exists to have dust of WrappedToken in the relayer
        // Therefor option 2 is chosen
        // 0 for the Euler primary account
        wrappedToken.withdraw(0, 2**256 - 1); //MAX_UINT forces option 2

        // TODO: Delete next line after design decision has been taken
        // uint256 mainAmountAfter = mainToken.balanceOf(address(this));

        uint256 withdrawnMainAmount = wrappedToken.convertBalanceToUnderlying(amount);

        console.log("UNWRAP: Relayer has amount of mainToken", mainToken.balanceOf(address(this)));
        console.log("UNWRAP: According to Euler Relayer wouldve got MainTokenAmount", withdrawnMainAmount);

        if (recipient != address(this)) {
            mainToken.safeApprove(address(this), withdrawnMainAmount);
            mainToken.safeTransferFrom(address(this), recipient, withdrawnMainAmount);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, withdrawnMainAmount);
        }
    }
}
