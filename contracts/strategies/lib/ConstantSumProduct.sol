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

contract ConstantSumProduct is FixedPoint {
    int256 internal constant CONST_0_3333333 = 333333333333333333;
    int256 internal constant CONST_0_5 = 500000000000000000;
    int256 internal constant CONST_1 = 1000000000000000000;

    function outGivenIn(
        uint256,
        uint256[] memory,
        uint256,
        uint256,
        uint256
    ) internal pure returns (uint256) {
        //TODO: implement out given in for this invariant
        revert("Not implemented yet");
    }

    function calculateInvariant(uint256 _amp, uint256[] memory balances)
        internal
        pure
        returns (uint256)
    {
        int256 amp = int256(_amp);
        int256 sum = 0;
        int256 prod = CONST_1;
        uint256 length = balances.length;
        for (uint256 i = 0; i < length; i++) {
            sum = sum + int256(balances[i]);
            prod = ((prod * int256(balances[i])) / CONST_1);
        }
        int256 n = int256(length);
        int256 nn = 1;
        for (uint256 i = 0; i < length; i++) {
            nn *= n;
        }
        //temp = nˆ2n * prod
        int256 temp = nn * nn * prod;
        int256 negative_q = (amp * temp * sum) / CONST_1;
        //P is positive is A > 1/(nˆn)
        int256 p = amp * temp - temp / nn;
        int256 c = LogExpMath.exp(
            p *
                (LogExpMath.exp(
                    (negative_q / (4 * p)) *
                        (negative_q / p) *
                        CONST_1 +
                        p /
                        27,
                    CONST_0_5
                ) / CONST_1) +
                negative_q /
                2,
            CONST_0_3333333
        );
        return uint256(c - (p * CONST_1) / (3 * c));
    }
}
