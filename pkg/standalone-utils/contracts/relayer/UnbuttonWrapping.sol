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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IUnbuttonToken.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title UnbuttonWrapping
 * @author @aalavandhan1984 (eng@fragments.org)
 * @notice Allows users to wrap and unwrap any rebasing elastic balance token into a
 *         a non-rebasing static balance version using the Unbutton wrapper.
 * @dev All functions must be payable so that it can be called as part of a multicall involving ETH.
 *      The rebasing token to be wrapped is called the "underlying" token.
 *      The wrapped non-rebasing token is called the "wrapped" token.
 *      Learn more: https://github.com/buttonwood-protocol/button-wrappers/blob/main/contracts/UnbuttonToken.sol
 */
abstract contract UnbuttonWrapping is IBaseRelayerLibrary {
    /// @param wrapperToken The address of the wrapper.
    /// @param sender The address of sender.
    /// @param sender The address of recepient.
    /// @param uAmount The underling token amount to be deposited into the wrapper.
    /// @param outputReference Chained output reference.
    function wrapUnbuttonToken(
        IUnbuttonToken wrapperToken,
        address sender,
        address recipient,
        uint256 uAmount,
        uint256 outputReference
    ) external payable {
        IERC20 underlyingToken = IERC20(wrapperToken.underlying());

        uAmount = _resolveAmountPullTokenAndApproveSpender(underlyingToken, address(wrapperToken), uAmount, sender);

        uint256 mintAmount = wrapperToken.depositFor(recipient, uAmount);

        _setChainedReference(outputReference, mintAmount);
    }

    /// @param wrapperToken The address of the wrapper.
    /// @param sender The address of sender.
    /// @param sender The address of recepient.
    /// @param amount The amount of wrapped tokens to be burnt for underlying tokens.
    /// @param outputReference Chained output reference.
    function unwrapUnbuttonToken(
        IUnbuttonToken wrapperToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        amount = _resolveAmountAndPullToken(wrapperToken, amount, sender);

        uint256 withdrawnUAmount = wrapperToken.burnTo(recipient, amount);

        _setChainedReference(outputReference, withdrawnUAmount);
    }
}
