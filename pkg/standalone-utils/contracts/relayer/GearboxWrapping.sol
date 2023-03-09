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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IGearboxDieselToken.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title GearboxWrapping
 * @notice Allows users to wrap and unwrap Gearbox tokens
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract GearboxWrapping is IBaseRelayerLibrary {
    function wrapGearbox(
        IGearboxDieselToken wrappedToken,
        address sender,
        address recipient,
        uint256 mainAmount,
        uint256 outputReference
    ) external payable {
        IGearboxVault gearboxVault = IGearboxVault(wrappedToken.owner());
        IERC20 underlying = IERC20(gearboxVault.underlyingToken());

        // Main Tokens are not deposited in the dieselToken address. Instead, they're deposited in a gearbox vault
        mainAmount = _resolveAmountPullTokenAndApproveSpender(underlying, address(gearboxVault), mainAmount, sender);

        // The third argument of addLiquidity is a referral code, which will be always 0 for the relayer (no referee)
        gearboxVault.addLiquidity(mainAmount, recipient, 0);

        _setChainedReference(outputReference, gearboxVault.toDiesel(mainAmount));
    }

    function unwrapGearbox(
        IGearboxDieselToken wrappedToken,
        address sender,
        address recipient,
        uint256 dieselAmount,
        uint256 outputReference
    ) external payable {
        dieselAmount = _resolveAmountAndPullToken(IERC20(address(wrappedToken)), dieselAmount, sender);

        // Main Tokens are not deposited in the dieselToken address. Instead, they're deposited in a gearbox vault.
        // Therefore, to remove liquidity, we withdraw tokens from the vault, and not from the wrapped token.
        IGearboxVault gearboxVault = IGearboxVault(wrappedToken.owner());
        gearboxVault.removeLiquidity(dieselAmount, recipient);

        _setChainedReference(outputReference, gearboxVault.fromDiesel(dieselAmount));
    }
}
