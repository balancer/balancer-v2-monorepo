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

import "../../math/FixedPoint.sol";
import "../../math/LogExpMath.sol";

// This is a contract to emulate file-level functions. Convert to a library
// after the migration to solc v0.7.1.

// solhint-disable private-vars-leading-underscore
// solhint-disable var-name-mixedcase

contract Stable is FixedPoint {
    uint256 internal constant PRECISION = 100000000000000;

    struct Data {
        uint256 amp;
        uint256 invariant;
        uint256 sum;
        uint256 nn;
        uint256 prod;
    }

    function _getData(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountIn
    ) private pure returns (Data memory) {
        uint256 invariant = _invariant(amp, balances);
        uint256 sum = 0;
        uint256 prod = ONE;
        uint256 n = balances.length;
        uint256 nn = 1;
        for (uint256 i = 0; i < n; i++) {
            if (i != tokenIndexOut) {
                if (i == tokenIndexIn) {
                    sum = sum + balances[i] + tokenAmountIn;
                    prod = (prod * (balances[i] + tokenAmountIn)) / ONE;
                } else {
                    sum = sum + balances[i];
                    prod = (prod * balances[i]) / ONE;
                }
            }
            nn = nn * n;
        }
        return
            Data({
                amp: amp,
                invariant: invariant,
                sum: sum,
                nn: nn,
                prod: prod
            });
    }

    function _calcTokenAmountOut(Data memory data, uint256 tokenAmountOut)
        private
        pure
        returns (uint256)
    {
        uint256 newTokenAmountOut;
        uint256 c1 = data.amp *
            data.sum +
            ((ONE / data.nn) - data.amp) *
            data.invariant;
        uint256 c2 = (data.invariant * data.invariant * data.invariant) /
            (data.nn * data.nn * data.prod);
        for (uint256 i = 0; i < 255; i++) {
            uint256 f1 = (((data.amp * tokenAmountOut * tokenAmountOut) / ONE) +
                ((c1 * tokenAmountOut) / ONE) -
                c2) * ONE;
            uint256 f2 = c1 + 2 * data.amp * tokenAmountOut;
            newTokenAmountOut = tokenAmountOut - (f1 / f2);
            if (newTokenAmountOut > tokenAmountOut) {
                if ((newTokenAmountOut - tokenAmountOut) <= PRECISION) {
                    break;
                }
            } else if ((newTokenAmountOut - tokenAmountOut) <= PRECISION) {
                break;
            }
            tokenAmountOut = newTokenAmountOut;
        }
        return newTokenAmountOut;
    }

    function _outGivenIn(
        uint256 amp,
        uint256[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 tokenAmountIn
    ) internal pure returns (uint256) {
        Data memory data = _getData(
            amp,
            balances,
            tokenIndexIn,
            tokenIndexOut,
            tokenAmountIn
        );
        uint256 tokenAmountOut = balances[tokenIndexOut] + tokenAmountIn;
        return
            balances[tokenIndexOut] - _calcTokenAmountOut(data, tokenAmountOut);
    }

    function _invariant(uint256 amp, uint256[] memory balances)
        internal
        pure
        returns (uint256)
    {
        uint256 sum = 0;
        uint256 prod = ONE;
        uint256 n = balances.length;
        uint256 nn = 1;
        for (uint256 i = 0; i < n; i++) {
            sum = sum + balances[i];
            prod = (prod * balances[i]) / ONE;
            nn = nn * n;
        }
        uint256 invariant = sum;
        uint256 newInvariant;
        uint256 c2 = amp - ONE / nn;
        uint256 c1 = (nn * nn * prod);
        for (uint256 i = 0; i < 255; i++) {
            uint256 f1 = (c2 *
                invariant +
                (((invariant * invariant) / c1) * invariant) -
                amp *
                sum) / ONE;
            uint256 f2 = (c2 * ONE + 3 * ((invariant * ONE) / c1) * invariant) /
                ONE;
            newInvariant =
                invariant -
                (2 * f1 * f2 * ONE) /
                (2 * f2 * f2 + f1 * 6 * ((invariant * ONE) / c1));
            if (newInvariant > invariant) {
                if ((newInvariant - invariant) <= PRECISION) {
                    return newInvariant;
                }
            } else if ((invariant - newInvariant) <= PRECISION) {
                return newInvariant;
            }
            invariant = newInvariant;
        }
        return newInvariant;
    }
}
