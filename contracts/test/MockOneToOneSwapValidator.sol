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

import "../validators/ISwapValidator.sol";

contract MockOneToOneSwapValidator is ISwapValidator {
    event ValidationData(IERC20 overallTokenIn, IERC20 overallTokenOut, uint128 maxAmountIn, uint128 minAmountOut);

    function validate(
        IVault.SwapKind,
        IERC20[] calldata,
        int256[] calldata,
        bytes calldata data
    ) external override {
        //Decode data
        (IERC20 overallTokenIn, IERC20 overallTokenOut, uint128 maxAmountIn, uint128 minAmountOut) = abi.decode(
            (data),
            (IERC20, IERC20, uint128, uint128)
        );

        //Validate
        emit ValidationData(overallTokenIn, overallTokenOut, maxAmountIn, minAmountOut);
    }
}
