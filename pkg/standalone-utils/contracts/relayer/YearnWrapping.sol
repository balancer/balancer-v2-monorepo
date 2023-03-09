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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IYearnTokenVault.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title YearnWrapping
 * @notice Allows users to wrap and unwrap Yearn tokens
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract YearnWrapping is IBaseRelayerLibrary {
    function wrapYearn(
        IYearnTokenVault wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        IERC20 underlying = IERC20(wrappedToken.token());

        amount = _resolveAmountPullTokenAndApproveSpender(underlying, address(wrappedToken), amount, sender);

        uint256 receivedWrappedAmount = wrappedToken.deposit(amount, recipient);

        _setChainedReference(outputReference, receivedWrappedAmount);
    }

    function unwrapYearn(
        IYearnTokenVault wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        amount = _resolveAmountAndPullToken(IERC20(address(wrappedToken)), amount, sender);

        uint256 mainAmount = wrappedToken.withdraw(amount, recipient);

        _setChainedReference(outputReference, mainAmount);
    }
}
