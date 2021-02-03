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

pragma experimental ABIEncoderV2;

pragma solidity ^0.7.1;

import "../vault/interfaces/ISwapValidator.sol";

contract OneToOneSwapValidator is ISwapValidator {
    function validate(
        IERC20[] calldata tokens,
        int256[] calldata vaultDeltas,
        bytes calldata data
    ) external view override {
        //Decode data
        (
            IERC20 overallTokenIn,
            IERC20 overallTokenOut,
            uint112 maxAmountIn,
            uint112 minAmountOut,
            uint256 deadline
        ) = abi.decode((data), (IERC20, IERC20, uint112, uint112, uint256));

        // Using timestamps is fine here, since the potential for griefing is minimal here. At the worst, a miner could
        // force a swap to fail by advancing the timestamp.
        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp <= deadline, "Deadline expired");

        //Validate
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            int256 delta = vaultDeltas[i];

            if (token == overallTokenIn) {
                require(delta <= maxAmountIn, "Excessive amount in");
            } else if (token == overallTokenOut) {
                // An int256 will always fit in an uint256, no need to safe cast
                uint256 deltaAbs = uint256(delta > 0 ? delta : -delta);
                require(deltaAbs >= minAmountOut, "Not enough tokens out");
            } else {
                require(delta == 0, "Intermediate non-zero balance");
            }
        }
    }
}
