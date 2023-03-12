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

import "./IBaseRelayerLibrary.sol";

/**
 * @title EulerWrapping
 * @notice Allows users to wrap and unwrap Euler tokens
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract EulerWrapping is IBaseRelayerLibrary {
    //solhint-disable-next-line private-vars-leading-underscore
    uint256 private constant MAX_UINT256 = type(uint256).max;

    function wrapEuler(
        IEulerToken wrappedToken,
        address eulerProtocol,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        IERC20 underlying = IERC20(wrappedToken.underlyingAsset());

        amount = _resolveAmountPullTokenAndApproveSpender(underlying, eulerProtocol, amount, sender);

        // Deposit MainToken into EulerToken
        // 0 for the Euler primary account
        wrappedToken.deposit(0, amount);

        uint256 receivedWrappedAmount = wrappedToken.balanceOf(address(this));

        _transferAndSetChainedReference(wrappedToken, recipient, receivedWrappedAmount, outputReference);
    }

    function unwrapEuler(
        IEulerToken wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        amount = _resolveAmountAndPullToken(wrappedToken, amount, sender);

        // Euler offers two ways to withdraw:
        //     1. Calculate mainTokenOut via wrappedToken.convertBalanceToUnderlying(wrappedTokenAmount)
        //     2. Redeem the account's full balance of wrappedToken for mainToken
        // Option 1 may leave wrappedToken dust in the relayer, so we choose option 2
        // The 0 argument is for the Euler primary account
        wrappedToken.withdraw(0, MAX_UINT256); //MAX_UINT256 forces option 2

        IERC20 mainToken = IERC20(wrappedToken.underlyingAsset());
        uint256 withdrawnMainAmount = mainToken.balanceOf(address(this));

        _transferAndSetChainedReference(mainToken, recipient, withdrawnMainAmount, outputReference);
    }
}
