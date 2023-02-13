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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";

import "@balancer-labs/v2-interfaces/contracts/pool-linear/ICToken.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title EulerWrapping
 * @notice Allows users to wrap and unwrap Euler tokens
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract MidasWrapping is IBaseRelayerLibrary {
    using Address for address payable;
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    /**
     *@dev
     *@notice pulls tokens from sender to relayer and calls mint? on a CToken.
     */
    function wrapMidas(
        ICToken wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        IERC20 underlying = IERC20(wrappedToken.underlying());

        // The wrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, underlying, amount);
        }

        underlying.safeApprove(address(wrappedToken), amount);

        // calculated balances of the wrappedToken in the Relayer
        IERC20 wrappedTokenErc20 = IERC20(address(wrappedToken));
        uint256 wrappedAmountBefore = wrappedTokenErc20.balanceOf(address(this));

        // The mint function transfers an asset into the Midas protocol, which begins accumulating interest
        // based on the current Supply Rate for the asset. The user receives a quantity of cTokens
        // equal to the underlying tokens supplied, divided by the current Exchange Rate.
        uint256 sent = wrappedToken.mint(amount);
        require(sent == 0, "failed to deposit into midas market");

        uint256 wrappedAmountAfter = wrappedTokenErc20.balanceOf(address(this));
        uint256 withdrawnWrappedAmount = wrappedAmountAfter - wrappedAmountBefore;

        if (recipient != address(this)) {
            wrappedTokenErc20.safeApprove(address(this), withdrawnWrappedAmount);
            wrappedTokenErc20.safeTransferFrom(address(this), recipient, withdrawnWrappedAmount);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, withdrawnWrappedAmount);
        }
    }

    function unwrapMidas(
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
            _pullToken(sender, IERC20(address(wrappedToken)), amount);
        }

        IERC20 mainToken = IERC20(wrappedToken.underlying());
        uint256 mainAmountBefore = mainToken.balanceOf(address(this));

        // The redeem function converts a specified quantity of cTokens into the underlying asset,
        // and returns them to the user. The amount of underlying tokens received is equal to the
        // quantity of cTokens redeemed, multiplied by the current Exchange Rate. The amount redeemed
        // must be less than the user’s Account Liquidity and the market’s available liquidity.
        wrappedToken.redeem(amount);
        uint256 mainAmountAfter = mainToken.balanceOf(address(this));
        uint256 withdrawnMainAmount = mainAmountAfter - mainAmountBefore;

        if (recipient != address(this)) {
            mainToken.safeApprove(address(this), withdrawnMainAmount);
            mainToken.safeTransferFrom(address(this), recipient, withdrawnMainAmount);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, withdrawnMainAmount);
        }
    }
}
