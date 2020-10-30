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
import "../../math/FixedPoint.sol";

// This is a contract to emulate file-level functions. Convert to a library
// after the migration to solc v0.7.1.

// solhint-disable private-vars-leading-underscore
// solhint-disable var-name-mixedcase

contract ConstantSumProduct {
    using SafeCast for uint256;

    // Computes how many tokens can be taken out of a pool if `tokenAmountIn` are sent, given the
    // current balances.
    function outGivenIn(
        uint256 amp,
        uint128[] memory balances,
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint128 tokenAmountIn
    ) internal pure returns (uint128) {
        uint256 D = calculateInvariant(amp, balances);
        uint256 c = D;
        uint256 S = 0;
        uint256 N_COINS = balances.length;
        uint256 Ann = amp * N_COINS;
        uint256 x = 0;
        for (uint256 i = 0; i < N_COINS; i++) {
            if (i == tokenIndexIn) {
                x = tokenAmountIn;
            } else if (i != tokenIndexOut) {
                x = balances[i];
            }
            S += x;
            c = (c * D) / (x * N_COINS);
        }
        c = (c * D) / (Ann * N_COINS);
        uint256 b = S + D / Ann;
        uint256 y_prev = 0;
        uint256 y = D;
        for (uint256 i = 0; i < 255; i++) {
            y_prev = y;
            y = (y * y + c) / (2 * y + b - D);
            if (y > y_prev) {
                if ((y - y_prev) <= 1) {
                    break;
                }
            } else if ((y_prev - y) <= 1) {
                break;
            }
        }
        return y.toUint128();
    }

    function calculateInvariant(uint256 amp, uint128[] memory balances)
        internal
        pure
        returns (uint256)
    {
        uint256 S = 0;
        uint256 N_COINS = balances.length;
        for (uint256 i = 0; i < N_COINS; i++) {
            S = S + balances[i];
        }
        if (S == 0) {
            return 0;
        }
        uint256 Dprev = 0;
        uint256 D = S;
        uint256 Ann = amp * N_COINS;
        //TODO: make calculations to test and document this approximation. Compare it with math approx.
        for (uint256 i = 0; i < 255; i++) {
            uint256 D_P = D;
            for (uint256 j = 0; j < N_COINS; j++) {
                D_P = (D_P * D) / (balances[j] * N_COINS);
            }
            Dprev = D;
            D =
                ((Ann * S + D_P * N_COINS) * D) /
                ((Ann - 1) * D + (N_COINS + 1) * D_P);
            // Equality with the precision of 1
            if (D > Dprev) {
                if ((D - Dprev) <= 1) {
                    break;
                }
            } else if ((Dprev - D) <= 1) {
                break;
            }
        }
        return D;
    }
}
