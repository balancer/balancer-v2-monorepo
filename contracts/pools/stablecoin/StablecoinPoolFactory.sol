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
pragma experimental ABIEncoderV2;

import "../../vault/interfaces/IVault.sol";

import "../BasePoolFactory.sol";

import "./StablecoinPool.sol";

contract StablecoinPoolFactory is BasePoolFactory {
    constructor(IVault _vault) BasePoolFactory(_vault) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function create(
        string memory name,
        string memory symbol,
        uint256 initialBPT,
        IERC20[] memory tokens,
        uint128[] memory amounts,
        uint128 amp,
        uint128 swapFee,
        bytes32 salt
    ) external returns (address) {
        return
            _create(
                abi.encodePacked(
                    type(StablecoinPool).creationCode,
                    // Make the sender the `from` address
                    abi.encode(vault, name, symbol, initialBPT, tokens, amounts, msg.sender, amp, swapFee)
                ),
                salt
            );
    }
}
