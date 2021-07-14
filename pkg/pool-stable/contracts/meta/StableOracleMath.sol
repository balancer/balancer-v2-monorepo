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

import "../StableMath.sol";
import "hardhat/console.sol";

contract StableOracleMath is StableMath {
    using FixedPoint for uint256;

    /**
     * @dev Calculates the spot price of token Y and BPT in token X.
     */
    function _calcLogPrices(
        uint256 amplificationParameter,
        uint256 balanceX,
        uint256 balanceY,
        int256 logBptTotalSupply
    ) internal pure returns (int256 logSpotPrice, int256 logBptPrice) {
        uint256 spotPrice = _calcSpotPrice(amplificationParameter, balanceX, balanceY);
        logBptPrice = _calcLogBptPrice(spotPrice, balanceX, balanceY, logBptTotalSupply);
        logSpotPrice = LogCompression.toLowResLog(spotPrice);
    }

    /**
     * @dev Calculates the spot price of token Y in token X.
     */
    function _calcSpotPrice(
        uint256 amplificationParameter,
        uint256 balanceX,
        uint256 balanceY
    ) internal pure returns (uint256) {
        /**************************************************************************************************************
        //                                                                                                           //
        //                             2.a.x.y + a.y^2 + b.y                                                         //
        // spot price Y/X = - dx/dy = -----------------------                                                        //
        //                             2.a.x.y + a.x^2 + b.x                                                         //
        //                                                                                                           //
        // n = 2                                                                                                     //
        // a = amp param * n                                                                                         //
        // b = D + a.(S - D)                                                                                         //
        // D = invariant                                                                                             //
        // S = sum of balances but x,y = 0 since x  and y are the only tokens                                        //
        **************************************************************************************************************/

        uint256 invariant = _calculateInvariant(amplificationParameter, _balances(balanceX, balanceY), true);

        uint256 a = (amplificationParameter * 2) / _AMP_PRECISION;
        uint256 b = Math.mul(invariant, a).sub(invariant);

        uint256 axy2 = Math.mul(a * 2, balanceX).mulDown(balanceY); // n = 2

        // dx = a.x.y.2 + a.y^2 - b.y
        uint256 derivativeX = axy2.add(Math.mul(a, balanceY).mulDown(balanceY)).sub(b.mulDown(balanceY));

        // dy = a.x.y.2 + a.x^2 - b.x
        uint256 derivativeY = axy2.add(Math.mul(a, balanceX).mulDown(balanceX)).sub(b.mulDown(balanceX));

        // The rounding direction is irrelevant as we're about to introduce a much larger error when converting to log
        // space. We use `divUp` as it prevents the result from being zero, which would make the logarithm revert. A
        // result of zero is therefore only possible with zero balances, which are prevented via other means.
        return derivativeX.divUp(derivativeY);
    }

    /**
     * @dev Calculates the price of BPT in token X. `logBptTotalSupply` should be the result of calling
     * `LogCompression.toLowResLog` with the current BPT supply, and `spotPrice` the price of token
     * Y in token X (obtainable via `_calcSpotPrice()`.
     *
     * The return value is a 4 decimal fixed-point number: use `LogCompression.fromLowResLog`
     * to recover the original value.
     */
    function _calcLogBptPrice(
        uint256 spotPrice,
        uint256 balanceX,
        uint256 balanceY,
        int256 logBptTotalSupply
    ) internal pure returns (int256) {
        /**************************************************************************************************************
        //                                                                                                           //
        //              balance X + (spot price Y/X * balance Y)                                                     //
        // BPT price = ------------------------------------------                                                    //
        //                          total supply                                                                     //
        //                                                                                                           //
        // ln(BPT price) = ln(balance X + (spot price Y/X * balance Y)) - ln(totalSupply)                            //
        **************************************************************************************************************/

        // The rounding direction is irrelevant as we're about to introduce a much larger error when converting to log
        // space. We use `mulUp` as it prevents the result from being zero, which would make the logarithm revert. A
        // result of zero is therefore only possible with zero balances, which are prevented via other means.
        uint256 totalBalanceX = balanceX.add(spotPrice.mulUp(balanceY));
        int256 logTotalBalanceX = LogCompression.toLowResLog(totalBalanceX);

        // Because we're subtracting two values in log space, this value has a larger error (+-0.0001 instead of
        // +-0.00005), which results in a final larger relative error of around 0.1%.
        return logTotalBalanceX - logBptTotalSupply;
    }

    function _balances(uint256 balanceX, uint256 balanceY) private pure returns (uint256[] memory balances) {
        balances = new uint256[](2);
        balances[0] = balanceX;
        balances[1] = balanceY;
    }
}
