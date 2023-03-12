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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/misc/IERC4626.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title ERC4626Wrapping
 * @notice Allows users to wrap and unwrap ERC4626 tokens
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract ERC4626Wrapping is IBaseRelayerLibrary {
    function wrapERC4626(
        IERC4626 wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        IERC20 underlying = IERC20(wrappedToken.asset());

        amount = _resolveAmountPullTokenAndApproveSpender(underlying, address(wrappedToken), amount, sender);

        uint256 result = wrappedToken.deposit(amount, recipient);

        _setChainedReference(outputReference, result);
    }

    function unwrapERC4626(
        IERC4626 wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        amount = _resolveAmountAndPullToken(wrappedToken, amount, sender);

        uint256 result = wrappedToken.redeem(amount, recipient, address(this));

        _setChainedReference(outputReference, result);
    }
}
