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

import "../../lib/math//LogExpMath.sol";
import "../../lib/math/FixedPoint.sol";
import "../../lib/math/Math.sol";
import "../../lib/helpers/InputHelpers.sol";

/* solhint-disable private-vars-leading-underscore */

contract WeightedOracleMath {
    using FixedPoint for uint256;

    int256 private constant _LOG_COMPRESSION_FACTOR = 1e14;
    int256 private constant _HALF_LOG_COMPRESSION_FACTOR = 0.5e14;

    /**
     * @dev Calculates the logarithm of the spot price of token B in token A.
     *
     * The return value is a 4 decimal fixed-point number: use `_fromLowResLog` to recover the original value.
     */
    function _calcLogSpotPrice(
        uint256 normalizedWeightA,
        uint256 balanceA,
        uint256 normalizedWeightB,
        uint256 balanceB
    ) internal pure returns (int256) {
        // Max balances are 2^112 and min weights are 0.01, so the division never overflows.

        // The rounding direction is irrelevant as we're about to introduce a much larger error when converting to log
        // space. We use `divUp` as it prevents the result from being zero, which would make the logarithm revert. A
        // result of zero is therefore only possible with zero balances, which are prevented via other means.
        uint256 spotPrice = balanceA.divUp(normalizedWeightA).divUp(balanceB.divUp(normalizedWeightB));
        return _toLowResLog(spotPrice);
    }

    /**
     * @dev Calculates the price of BPT in a token. `logBptTotalSupply` should be the result of calling `_toLowResLog`
     * with the current BPT supply.
     *
     * The return value is a 4 decimal fixed-point number: use `_fromLowResLog` to recover the original value.
     */
    function _calcLogBPTPrice(
        uint256 normalizedWeight,
        uint256 balance,
        int256 logBptTotalSupply
    ) internal pure returns (int256) {
        // BPT price = (balance / weight) / total supply
        // Since we already have ln(total supply) and want to compute ln(BPT price), we perform the computation in log
        // space directly: ln(BPT price) = ln(balance / weight) - ln(total supply)

        // The rounding direction is irrelevant as we're about to introduce a much larger error when converting to log
        // space. We use `divUp` as it prevents the result from being zero, which would make the logarithm revert. A
        // result of zero is therefore only possible with zero balances, which are prevented via other means.
        int256 logBalanceOverWeight = _toLowResLog(balance.divUp(normalizedWeight));

        // Because we're subtracting two values in log space, this value has a larger error (+-0.0001 instead of
        // +-0.00005), which results in a final larger relative error of around 0.1%.
        return logBalanceOverWeight - logBptTotalSupply;
    }

    /**
     * @dev Returns the natural logarithm of `value`, dropping most of the decimal places to arrive at a value that,
     * when passed to `_fromLowResLog`, will have a maximum relative error of ~0.05% compared to `value`.
     *
     * Values returned from this function should not be mixed with other fixed-point values (as they have a different
     * number of digits), but can be added or subtracted. Use `_fromLowResLog` to undo this process and return to an
     * 18 decimal places fixed point value.
     *
     * Because so much precision is lost, the logarithmic values can be stored using much fewer bits than the original
     * value required.
     */
    function _toLowResLog(uint256 value) internal pure returns (int256) {
        int256 ln = LogExpMath.ln(int256(value));

        // Rounding division for signed numerator
        return
            (ln > 0 ? ln + _HALF_LOG_COMPRESSION_FACTOR : ln - _HALF_LOG_COMPRESSION_FACTOR) / _LOG_COMPRESSION_FACTOR;
    }

    /**
     * @dev Restores `value` from logarithmic space. `value` is expected to be the result of a call to `_toLowResLog`,
     * any other function that returns 4 decimals fixed point logarithms, or the sum of such values.
     */
    function _fromLowResLog(int256 value) internal pure returns (uint256) {
        return uint256(LogExpMath.exp(value * _LOG_COMPRESSION_FACTOR));
    }
}
