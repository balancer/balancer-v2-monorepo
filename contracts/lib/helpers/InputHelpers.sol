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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

library InputHelpers {
    function ensureInputLengthMatch(uint256 a, uint256 b) internal pure {
        require(a == b, "INPUT_LENGTH_MISMATCH");
    }

    function ensureInputLengthMatch(
        uint256 a,
        uint256 b,
        uint256 c
    ) internal pure {
        require(a == b && b == c, "INPUT_LENGTH_MISMATCH");
    }

    function ensureArrayIsSorted(IERC20[] memory array) internal pure {
        if (array.length < 2) {
            return;
        }

        IERC20 previous = array[0];
        for (uint256 i = 1; i < array.length; ++i) {
            IERC20 current = array[i];
            require(previous < current, "UNSORTED_ARRAY");
            previous = current;
        }
    }
}
