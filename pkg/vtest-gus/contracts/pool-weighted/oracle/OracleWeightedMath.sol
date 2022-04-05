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

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/LogCompression.sol";

// These functions start with an underscore, as if they were part of a contract and not a library. At some point this
// should be fixed.
// solhint-disable private-vars-leading-underscore

library OracleWeightedMath {
    using FixedPoint for uint256;

    /**
     * @dev Calculates the logarithm of the spot price of token B in token A.
     *
     * The return value is a 4 decimal fixed-point number: use `LogCompression.fromLowResLog`
     * to recover the original value.
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
        return LogCompression.toLowResLog(spotPrice);
    }

    /**
     * @dev Calculates the price of BPT in a token. `logBptTotalSupply` should be the result of calling `toLowResLog`
     * with the current BPT supply.
     *
     * The return value is a 4 decimal fixed-point number: use `LogCompression.fromLowResLog`
     * to recover the original value.
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
        uint256 balanceOverWeight = balance.divUp(normalizedWeight);
        int256 logBalanceOverWeight = LogCompression.toLowResLog(balanceOverWeight);

        // Because we're subtracting two values in log space, this value has a larger error (+-0.0001 instead of
        // +-0.00005), which results in a final larger relative error of around 0.1%.
        return logBalanceOverWeight - logBptTotalSupply;
    }
}
