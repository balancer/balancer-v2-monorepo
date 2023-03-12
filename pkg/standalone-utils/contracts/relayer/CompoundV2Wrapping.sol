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

import "./IBaseRelayerLibrary.sol";

/**
 * @title CompoundV2Wrapping
 * @notice Allows users to wrap and unwrap Compound v2 cTokens
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract CompoundV2Wrapping is IBaseRelayerLibrary {
    function wrapCompoundV2(
        ICToken wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        IERC20 mainToken = IERC20(wrappedToken.underlying());
        amount = _resolveAmountPullTokenAndApproveSpender(mainToken, address(wrappedToken), amount, sender);

        // The `mint` function deposits `amount` underlying tokens and transfers cTokens to the caller.
        // It returns an error code, where zero indicates success. Other error codes can be found here:
        // https://github.com/compound-finance/compound-protocol/blob/a3214f67b73310d547e00fc578e8355911c9d376/contracts/ErrorReporter.sol
        // solhint-disable-previous-line max-line-length
        require(wrappedToken.mint(amount) == 0, "wrapping failed");

        uint256 receivedWrappedAmount = wrappedToken.balanceOf(address(this));

        _transferAndSetChainedReference(wrappedToken, recipient, receivedWrappedAmount, outputReference);
    }

    function unwrapCompoundV2(
        ICToken wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        amount = _resolveAmountAndPullToken(wrappedToken, amount, sender);

        IERC20 mainToken = IERC20(wrappedToken.underlying());

        // The `redeem` function burns `amount` cTokens and transfers underlying tokens to the caller.
        // It returns an error code, where zero indicates success. Other error codes can be found here:
        // https://github.com/compound-finance/compound-protocol/blob/a3214f67b73310d547e00fc578e8355911c9d376/contracts/ErrorReporter.sol
        // solhint-disable-previous-line max-line-length
        require(wrappedToken.redeem(amount) == 0, "unwrapping failed");

        uint256 withdrawnMainAmount = mainToken.balanceOf(address(this));

        _transferAndSetChainedReference(mainToken, recipient, withdrawnMainAmount, outputReference);
    }
}
