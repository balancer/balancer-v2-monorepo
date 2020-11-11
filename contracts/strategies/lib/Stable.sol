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

import "hardhat/console.sol";


import "../../math/FixedPoint.sol";

// This is a contract to emulate file-level functions. Convert to a library
// after the migration to solc v0.7.1.

// solhint-disable private-vars-leading-underscore
// solhint-disable var-name-mixedcase

contract Stable {
    int256 internal constant PRECISION = 100000000000000;

    struct Data {
        int256 amp;
        int256 invariant;
        int256 sum;
        int256 nn;
        int256 prod;
    }

    function _approximateAmount(Data memory data, uint128 approxAmount)
        private
        pure
        returns (uint128)
    {
        uint128 newApproxAmount;
        int256 c1 = data.amp *
            data.sum +
            ((FixedPoint.ONE / data.nn) - data.amp) *
            data.invariant;
        int256 c2 = (data.invariant * data.invariant * data.invariant) /
            (data.nn * data.nn * data.prod);
        for (int256 i = 0; i < 255; i++) {
            int256 f1 = data.amp *
                approxAmount *
                approxAmount +
                c1 *
                approxAmount -
                c2 *
                FixedPoint.ONE;
            int256 f2 = c1 + 2 * data.amp * approxAmount;
            newApproxAmount = uint128(approxAmount - (f1 / f2));
            if (newApproxAmount > approxAmount) {
                if ((newApproxAmount - approxAmount) <= PRECISION) {
                    break;
                }
            } else if ((newApproxAmount - approxAmount) <= PRECISION) {
                break;
            }
            approxAmount = newApproxAmount;
        }
        return newApproxAmount;
    }

    function _getDataOutGivenIn(
        int256 amp,
        uint128[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint128 tokenAmountIn
    ) private pure returns (Data memory) {
        int256 invariant = _invariant(amp, balances);
        int256 sum = 0;
        int256 prod = FixedPoint.ONE;
        uint256 n = balances.length;
        int256 nn = 1;
        for (uint256 i = 0; i < n; i++) {
            if (i != tokenIndexOut) {
                if (i == tokenIndexIn) {
                    sum = sum + balances[i] + tokenAmountIn;
                    prod =
                        (prod * (balances[i] + tokenAmountIn)) /
                        FixedPoint.ONE;
                } else {
                    sum = sum + balances[i];
                    prod = (prod * balances[i]) / FixedPoint.ONE;
                }
            }
            nn = nn * int256(n);
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

    function _getDataInGivenOut(
        int256 amp,
        uint128[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint128 tokenAmountOut
    ) private pure returns (Data memory) {
        int256 invariant = _invariant(amp, balances);
        int256 sum = 0;
        int256 prod = FixedPoint.ONE;
        uint256 n = balances.length;
        int256 nn = 1;
        for (uint256 i = 0; i < n; i++) {
            if (i != tokenIndexIn) {
                if (i == tokenIndexOut) {
                    sum = sum + balances[i] - tokenAmountOut;
                    prod =
                        (prod * (balances[i] - tokenAmountOut)) /
                        FixedPoint.ONE;
                } else {
                    sum = sum + balances[i];
                    prod = (prod * balances[i]) / FixedPoint.ONE;
                }
            }
            nn = nn * int256(n);
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

    function _outGivenIn(
        int256 amp,
        uint128[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint128 tokenAmountIn
    ) internal pure returns (uint128) {
        Data memory data = _getDataOutGivenIn(
            amp,
            balances,
            tokenIndexIn,
            tokenIndexOut,
            tokenAmountIn
        );
        uint128 approxTokenAmountOut = balances[tokenIndexOut] - tokenAmountIn;
        return
            balances[tokenIndexOut] -
            _approximateAmount(data, approxTokenAmountOut);
    }

    function _inGivenOut(
        int256 amp,
        uint128[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint128 tokenAmountOut
    ) internal pure returns (uint128) {
        Data memory data = _getDataInGivenOut(
            amp,
            balances,
            tokenIndexIn,
            tokenIndexOut,
            tokenAmountOut
        );
        uint128 approxTokenAmountIn = balances[tokenIndexIn] + tokenAmountOut;
        return
            _approximateAmount(data, approxTokenAmountIn) -
            balances[tokenIndexIn];
    }

    function _invariant(int256 amp, uint128[] memory balances)
        internal
        pure
        returns (int256)
    {
        int256 sum = 0;
        int256 prod = FixedPoint.ONE;
        uint256 n = balances.length;
        int256 nn = 1;
        for (uint256 i = 0; i < n; i++) {
            sum = sum + balances[i];
            prod = (prod * balances[i]) / FixedPoint.ONE;
            nn = nn * int256(n);
        }
        int256 invariant = sum;
        int256 newInvariant;
        int256 c2 = amp - FixedPoint.ONE / nn;
        int256 c1 = (nn * nn * prod);
        for (int256 i = 0; i < 255; i++) {
            int256 f1 = (c2 *
                invariant +
                (((invariant * invariant) / c1) * invariant) -
                amp *
                sum) / FixedPoint.ONE;
            int256 f2 = (c2 *
                FixedPoint.ONE +
                3 *
                ((invariant * FixedPoint.ONE) / c1) *
                invariant) / FixedPoint.ONE;
            newInvariant =
                invariant -
                (2 * f1 * f2 * FixedPoint.ONE) /
                (2 * f2 * f2 + f1 * 6 * ((invariant * FixedPoint.ONE) / c1));
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
