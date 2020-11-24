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

import "hardhat/console.sol";

import "./ISwapValidator.sol";

contract SwapValidator is ISwapValidator {
    using SafeCast for uint256;
    using SafeCast for int256;
    using FixedPoint for uint256;
    using FixedPoint for int256;
    using FixedPoint for uint128;

    function validate(
        IVault.SwapKind kind,
        IERC20[] calldata tokens,
        int256[] calldata vaultDeltas,
        bytes calldata data
    ) external pure override {
        //Decode data
        (IERC20 overallTokenIn, IERC20 overallTokenOut, uint128 maxAmountIn, uint128 minAmountOut) = abi.decode(
            (data),
            (IERC20, IERC20, uint128, uint128)
        );

        //Validate
        if (kind == IVault.SwapKind.GIVEN_IN) {
            for (uint256 i = 0; i < tokens.length; ++i) {
                if (tokens[i] == overallTokenIn) {
                    require(vaultDeltas[i] <= maxAmountIn, "Excessive amount in");
                } else if (tokens[i] == overallTokenOut) {
                    require(vaultDeltas[i].abs() >= minAmountOut, "Not enough tokens out");
                } else {
                    require(vaultDeltas[i] == 0, "Intermediate non-zero balance");
                }
            }
        } else {
            //TODO: validate in given out
            revert("In given out not supported yet");
        }
    }
}
