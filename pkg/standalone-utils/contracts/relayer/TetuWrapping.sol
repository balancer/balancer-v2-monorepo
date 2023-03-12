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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/ITetuSmartVault.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title TetuWrapping
 * @notice Allows users to wrap and unwrap Tetu tokens
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract TetuWrapping is IBaseRelayerLibrary {
    function wrapTetu(
        ITetuSmartVault wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        IERC20 underlying = IERC20(wrappedToken.underlying());

        amount = _resolveAmountPullTokenAndApproveSpender(underlying, address(wrappedToken), amount, sender);

        wrappedToken.deposit(amount);
        uint256 receivedWrappedAmount = wrappedToken.balanceOf(address(this));

        _transferAndSetChainedReference(wrappedToken, recipient, receivedWrappedAmount, outputReference);
    }

    function unwrapTetu(
        ITetuSmartVault wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        amount = _resolveAmountAndPullToken(wrappedToken, amount, sender);

        IERC20 mainToken = IERC20(wrappedToken.underlying());
        wrappedToken.withdraw(amount);
        uint256 withdrawnMainAmount = mainToken.balanceOf(address(this));

        _transferAndSetChainedReference(mainToken, recipient, withdrawnMainAmount, outputReference);
    }
}
