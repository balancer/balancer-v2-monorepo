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

import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../math/FixedPoint.sol";


abstract contract StrategyFee {
    using SafeCast for uint256;
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    uint256 public constant MIN_FEE = 0;
    //uint256 public constant MIN_FEE = 10**12; //0.000001%
    uint256 public constant MAX_FEE = 10**17; //0.1%

    /**
     * @dev Returns the swap fee for the Trading Strategy.
     */
    function getSwapFee() external view returns (uint256) {
        return _getSwapFee();
    }

    function _addFee(uint128 amount) internal view returns (uint128) {
        return amount.div128(FixedPoint.ONE.sub128(_getSwapFee().toUint128()));
    }

    function _subtractFee(uint128 amount) internal view returns (uint128) {
        uint128 fees = amount.mul128(_getSwapFee().toUint128());
        return amount.sub128(fees);
    }

    function _getSwapFee() internal view virtual returns (uint256);
}
