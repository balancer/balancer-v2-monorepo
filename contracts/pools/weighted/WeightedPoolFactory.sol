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

import "./WeightedPool.sol";

contract WeightedPoolFactory is BasePoolFactory {
    constructor(IVault _vault) BasePoolFactory(_vault) {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Deploys a new `WeightedPool`.
     */
    function create(
        string memory name,
        string memory symbol,
        uint256 initialBPT,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory weights,
        uint256 swapFee
    ) external returns (address) {
        return
            _create(
                abi.encodePacked(
                    type(WeightedPool).creationCode,
                    // Make the sender the `from` address
                    abi.encode(_vault, name, symbol, initialBPT, tokens, amounts, msg.sender, weights, swapFee)
                )
            );
    }
}
