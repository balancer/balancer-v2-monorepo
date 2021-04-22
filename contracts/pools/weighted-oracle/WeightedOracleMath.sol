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

contract WeightedOracleMath {
    using SafeCast for uint256;
    using SafeCast for int256;
    using FixedPoint for uint256;

    function _calculateInvariantAndLn(
        uint256 normalizedWeightA,
        uint256 balanceA,
        uint256 normalizedWeightB,
        uint256 balanceB
    ) internal pure returns (uint256 invariant, int256 invariantLn) {
        uint256 term1 = balanceA.powDown(normalizedWeightA);
        uint256 term2 = balanceB.powDown(normalizedWeightB);

        invariant = term1.mulDown(term2);

        _require(invariant > 0, Errors.ZERO_INVARIANT);

        invariantLn = SignedFixedPoint.ln(invariant.toInt256());
    }

    function _calculateSpotPriceAndLn(
        uint256 normalizedWeightA,
        uint256 balanceA,
        uint256 normalizedWeightB,
        uint256 balanceB
    ) internal pure returns (uint256 spotPrice, int256 spotPriceLn) {
        //Rounding down spot price
        spotPrice = balanceA.divDown(normalizedWeightA).divDown(balanceB.divUp(normalizedWeightB));

        spotPriceLn = SignedFixedPoint.ln(spotPrice.toInt256());
    }

    function _calculateBPTPriceChangeFactorAndLn(
        uint256 normalizedWeightA,
        uint256 balanceA,
        uint256 normalizedWeightB,
        uint256 balanceB,
        uint256 prevSpotPriceAB,
        uint256 prevBptPriceFactor
    ) internal pure returns (uint256 bptPriceFactor, int256 bptPriceFactorLn) {
        //Rounding down overall

        uint256 currentSpotPrice = balanceA.divDown(normalizedWeightA).divDown(balanceB.divUp(normalizedWeightB));

        uint256 base = currentSpotPrice.divDown(prevSpotPriceAB);
        uint256 exponent = balanceB.divDown(balanceB.add(balanceA));

        bptPriceFactor = base.powDown(exponent).mulDown(prevBptPriceFactor);

        bptPriceFactorLn = SignedFixedPoint.ln(bptPriceFactor.toInt256());
    }
}
