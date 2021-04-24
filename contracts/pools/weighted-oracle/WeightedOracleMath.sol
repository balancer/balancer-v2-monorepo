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

    int256 internal constant _INVARIANT_COMPRESSION_FACTOR = 1e15;
    int256 internal constant _PRICE_COMPRESSION_FACTOR = 1e14;

    function _calculatelInvariantLn(
        uint256 normalizedWeightA,
        uint256 balanceA,
        uint256 normalizedWeightB,
        uint256 balanceB
    ) internal pure returns (int256 invariantLn) {
        //We can cast weights and balances to int256 becuase they are always lower than the max int256.
        int256 term1 = int256(normalizedWeightA).mul(SignedFixedPoint.ln(int256(balanceA)));
        int256 term2 = int256(normalizedWeightB).mul(SignedFixedPoint.ln(int256(balanceB)));

        invariantLn = term1.add(term2) / _INVARIANT_COMPRESSION_FACTOR;
    }

    function _calculateSpotPriceLn(
        uint256 normalizedWeightA,
        uint256 balanceA,
        uint256 normalizedWeightB,
        uint256 balanceB
    ) internal pure returns (int256 spotPriceLn) {
        //Rounding direction does not matter because we are compressing the log result at the end.
        uint256 spotPrice = balanceA.divDown(normalizedWeightA).divDown(balanceB.divUp(normalizedWeightB));

        spotPriceLn = SignedFixedPoint.ln(spotPrice.toInt256()) / _PRICE_COMPRESSION_FACTOR;
    }

    function _calculateBPTPriceLn(
        uint256 normalizedWeight,
        uint256 balance,
        int256 bptTotalSupplyLn
    ) internal pure returns (int256 bptPriceLn) {
        //Rounding direction does not matter because we are compressing the log result at the end.
        int256 totalBptLn = SignedFixedPoint.ln(balance.divDown(normalizedWeight).toInt256());

        bptPriceLn = totalBptLn / _INVARIANT_COMPRESSION_FACTOR - bptTotalSupplyLn;
    }

    function _calculateBptTotalSupplyLn(uint256 bptTotalSupply) internal pure returns (int256 bptTotalSupplyLn) {
        bptTotalSupplyLn = SignedFixedPoint.ln(bptTotalSupply.toInt256()) / _INVARIANT_COMPRESSION_FACTOR;
    }
}
