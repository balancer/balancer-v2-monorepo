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

import "../../math/FixedPoint.sol";

contract SwapFeeStrategySetting {
    using FixedPoint for uint128;

    uint128 public constant MIN_FEE = 0;
    uint128 public constant MAX_FEE = 10**17; // 0.1%

    uint128 private _mutableSwapFee;
    uint128 private immutable _immutableSwapFee;
    bool private immutable _isMutable;

    struct SwapFee {
        bool isMutable;
        uint128 value;
    }

    event SwapFeeSet(uint128 swapFee);

    constructor(SwapFee memory swapFee) {
        _validateSwapFee(swapFee.value);
        _isMutable = swapFee.isMutable;
        _immutableSwapFee = swapFee.isMutable ? 0 : swapFee.value;
        if (swapFee.isMutable) {
            _mutableSwapFee = swapFee.value;
        }
        emit SwapFeeSet(swapFee.value);
    }

    /**
     * @dev Returns the swap fee for the trading strategy
     */
    function getSwapFee() external view returns (uint128) {
        return _swapFee();
    }

    /**
     * @dev Set a new swap fee
     * @param swapFee New swap fee to be set
     */
    function _setSwapFee(uint128 swapFee) internal {
        require(_isMutable, "SWAP_FEE_NOT_MUTABLE");
        _validateSwapFee(swapFee);
        _mutableSwapFee = swapFee;
        emit SwapFeeSet(swapFee);
    }

    /**
     * @dev Internal function to tell the swap fee for the trading strategy
     */
    function _swapFee() internal view returns (uint128) {
        return _isMutable ? _mutableSwapFee : _immutableSwapFee;
    }

    function _addSwapFee(uint128 amount) internal view returns (uint128) {
        return amount.div128(FixedPoint.ONE.sub128(_swapFee()));
    }

    function _subtractSwapFee(uint128 amount) internal view returns (uint128) {
        uint128 fees = amount.mul128(_swapFee());
        return amount.sub128(fees);
    }

    function _validateSwapFee(uint128 swapFee) private pure {
        require(swapFee >= MIN_FEE, "ERR_MIN_FEE");
        require(swapFee <= MAX_FEE, "ERR_MAX_FEE");
    }
}
