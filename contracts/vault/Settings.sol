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

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "../math/FixedPoint.sol";
import "./IVault.sol";

abstract contract Settings is IVault {
    using FixedPoint for uint128;

    // Protocol fees: these are charged as unaccounted for tokens, and can therefore be claimed and distributed by the
    // system admin.

    // The withdraw fee is charged whenever tokens exit the vault (except in the case of swaps), and is a
    // percentage of the tokens exiting
    uint128 private _protocolWithdrawFee;

    // The swap fee is charged whenever a swap occurs, and is a percentage of the fee charged by the trading strategy.
    // The Vault relies on the trading strategy being honest and reporting the actuall fee it charged.
    uint128 private _protocolSwapFee;

    uint128 private immutable MAX_PROTOCOL_WITHDRAW_FEE = FixedPoint
        .ONE
        .mul128(2)
        .div128(100); // 0.02 (2%)

    uint128 private immutable MAX_PROTOCOL_SWAP_FEE = FixedPoint
        .ONE
        .mul128(50)
        .div128(100); // 0.5 (50%)

    function _setProtocolWithdrawFee(uint128 newFee) internal {
        require(newFee <= MAX_PROTOCOL_WITHDRAW_FEE, "Withdraw fee too high");
        _protocolWithdrawFee = newFee;
    }

    function protocolWithdrawFee() public view returns (uint128) {
        return _protocolWithdrawFee;
    }

    function _applyProtocolWithdrawFee(uint128 amount)
        internal
        view
        returns (uint128)
    {
        uint128 fee = amount.mul128(_protocolWithdrawFee);
        return amount.sub128(fee);
    }

    function _setProtocolSwapFee(uint128 newFee) internal {
        require(newFee <= MAX_PROTOCOL_SWAP_FEE, "Swap fee too high");
        _protocolSwapFee = newFee;
    }

    function protocolSwapFee() public view returns (uint128) {
        return _protocolSwapFee;
    }

    function _calculateProtocolSwapFee(uint128 swapFeeAmount)
        internal
        view
        returns (uint128)
    {
        return swapFeeAmount.mul128(_protocolSwapFee);
    }
}
