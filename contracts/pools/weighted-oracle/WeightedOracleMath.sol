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
import "../../lib/math/SignedFixedPoint.sol";
import "../../lib/math/Math.sol";
import "../../lib/helpers/InputHelpers.sol";
import "../../lib/openzeppelin/SafeCast.sol";

/* solhint-disable private-vars-leading-underscore */

contract WeightedOracleMath {
    using SafeCast for uint256;
    using SafeCast for int256;
    using FixedPoint for uint256;
    using SignedFixedPoint for int256;

    int256 internal constant _COMPRESSION_FACTOR = 1e14;

    /**
     * @dev Converts `value` to logarithmic space, dropping most of the decimal places to arrive at a value that, when
     * passed to `_fromLogSpace`, will have a maximum relative error of 0.1%.
     */
    function _toLogSpace(uint256 value) internal pure returns (int256) {
        return LogExpMath.ln(int256(value)) / _COMPRESSION_FACTOR;
    }

    /**
     * @dev Restores `value` from logarithmic space.
     */
    function _fromLogSpace(int256 value) internal pure returns (uint256) {
        return uint256(LogExpMath.exp(value * _COMPRESSION_FACTOR));
    }

    function _calcLnSpotPrice(
        uint256 normalizedWeightA,
        uint256 balanceA,
        uint256 normalizedWeightB,
        uint256 balanceB
    ) internal pure returns (int256) {
        // Max balances are 2^112 and min weights are 0.01, so balance / weight can always be computed.
        // Rounding direction is irrelevant as we're about to introduce much larger error when converting to log space:
        // we use divDown because it uses less gas.
        uint256 spotPrice = balanceA.divDown(normalizedWeightA).divDown(balanceB.divDown(normalizedWeightB));
        return _toLogSpace(spotPrice);
    }

    function _calcLnBPTPrice(
        uint256 normalizedWeight,
        uint256 balance,
        int256 bptTotalSupplyLn
    ) internal pure returns (int256) {
        // BPT price = (balance / weight) / total supply
        // Since we already have ln(total supply) and want to compute ln(BPT price), we perform the computation in log
        // space directly: ln(BPT price) = ln(balance / weight) - ln(total supply)

        // Rounding direction is irrelevant as we're about to introduce much larger error when converting to log space:
        // we use divDown because it uses less gas.
        int256 lnBalanceOverWeight = _toLogSpace(balance.divDown(normalizedWeight));

        // Because we're subtracting two values in log space, this value has larger error (+-0.0002 instead of
        // +-0.0001), which translatess in a final larger relative error of around 0.2%.
        return lnBalanceOverWeight - bptTotalSupplyLn;
    }
}
