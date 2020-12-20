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

// Imports

import "hardhat/console.sol";

import "./ISwapValidator.sol";

// Contracts

/**
 * @title One-to-one SwapValidator
 * @author Balancer Labs
 * @notice Ensure the swap is timely, and all balances are as expected
 */
contract OneToOneSwapValidator is ISwapValidator {
    using SafeCast for uint256;
    using SafeCast for int256;
    using FixedPoint for uint256;
    using FixedPoint for int256;
    using FixedPoint for uint128;

    // Function declarations

    // External functions

    /**
     * @notice Validate a swap (approve for execution)
     * param IVault.SwapKind - Direction (In or Out) - unused
     * @param tokens - the tokens being swapped
     * @param vaultDeltas - the net effect of the swap on the balances in the vault
     * @param data - any external data needed by the validator
     */
    function validate(
        IVault.SwapKind,
        IERC20[] calldata tokens,
        int256[] calldata vaultDeltas,
        bytes calldata data
    ) external view override {
        //Decode data
        (
            IERC20 overallTokenIn,
            IERC20 overallTokenOut,
            uint128 maxAmountIn,
            uint128 minAmountOut,
            uint256 deadline
        ) = abi.decode((data), (IERC20, IERC20, uint128, uint128, uint256));

        // Using timestamps is fine here, since the potential for griefing is minimal here. At the worst, a miner could
        // force a swap to fail by advancing the timestamp.
        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp <= deadline, "Deadline expired");

        // Validate
        for (uint256 i = 0; i < tokens.length; ++i) {
            if (tokens[i] == overallTokenIn) {
                require(vaultDeltas[i] <= maxAmountIn, "Excessive amount in");
            } else if (tokens[i] == overallTokenOut) {
                require(vaultDeltas[i].abs() >= minAmountOut, "Not enough tokens out");
            } else {
                require(vaultDeltas[i] == 0, "Intermediate non-zero balance");
            }
        }
    }
}
