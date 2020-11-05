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

    uint128 private _withdrawFee;

    uint128 private immutable MAX_WITHDRAW_FEE = FixedPoint
        .ONE
        .mul128(2)
        .div128(100); // 0.02 (2%)

    function _setWithdrawFee(uint128 newFee) internal {
        require(newFee <= MAX_WITHDRAW_FEE, "Withdraw fee too high");
        _withdrawFee = newFee;
    }

    function withdrawFee() public view returns (uint128) {
        return _withdrawFee;
    }

    function _applyWithdrawFee(uint128 amount) internal view returns (uint128) {
        uint128 fee = amount.mul128(_withdrawFee);
        return amount.sub128(fee);
    }
}
