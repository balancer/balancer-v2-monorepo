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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/ICToken.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title CompoundV2Wrapping
 * @notice Allows users to wrap and unwrap CompoundV2CTokens tokens
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract CompoundV2Wrapping is IBaseRelayerLibrary {
    using Address for address payable;
    using SafeERC20 for IERC20;

    /**
     *@dev
     *@notice pulls tokens from sender to relayer and calls mint? on a CToken.
     */
    function wrapCompoundV2(
        ICToken wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        IERC20 mainToken = IERC20(wrappedToken.underlying());

        // The wrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, mainToken, amount);
        }

        mainToken.safeApprove(address(wrappedToken), amount);

        // The mint function transfers an asset into the CompoundV2 protocol, which begins accumulating interest
        // based on the current Supply Rate for the asset. The user receives a quantity of cTokens
        // equal to the underlying tokens supplied, divided by the current Exchange Rate.
        require(wrappedToken.mint(amount) == 0, "wrapping failed");

        uint256 receivedWrappedAmount = wrappedToken.balanceOf(address(this));

        if (recipient != address(this)) {
            IERC20(wrappedToken).safeTransfer(recipient, receivedWrappedAmount);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, receivedWrappedAmount);
        }
    }

    function unwrapCompoundV2(
        ICToken wrappedToken,
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

        IERC20 mainToken = IERC20(wrappedToken.underlying());

        // The redeem function converts a specified quantity of cTokens into the underlying asset,
        // and returns them to the user. The amount of underlying tokens received is equal to the
        // quantity of cTokens redeemed, multiplied by the current Exchange Rate. The amount redeemed
        // must be less than the user’s Account Liquidity and the market’s available liquidity.
        require(wrappedToken.redeem(amount) == 0, "unwrapping failed");
        uint256 withdrawnMainAmount = mainToken.balanceOf(address(this));

        if (recipient != address(this)) {
            mainToken.safeTransfer(recipient, withdrawnMainAmount);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, withdrawnMainAmount);
        }
    }
}
