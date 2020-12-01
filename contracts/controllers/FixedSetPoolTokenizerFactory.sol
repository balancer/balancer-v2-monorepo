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

import "../vault/IVault.sol";

import "./BasePoolControllerFactory.sol";
import "./FixedSetPoolTokenizer.sol";

contract FixedSetPoolTokenizerFactory is BasePoolControllerFactory {
    constructor(IVault _vault) BasePoolControllerFactory(_vault) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function create(
        address strategy,
        IVault.StrategyType strategyType,
        uint256 initialBPT,
        address[] memory tokens,
        uint128[] memory amounts,
        bytes32 salt
    ) external returns (address) {
        return
            _create(
                abi.encodePacked(
                    type(FixedSetPoolTokenizer).creationCode,
                    // Make the sender the `from` address
                    abi.encode(vault, strategy, strategyType, initialBPT, tokens, amounts, msg.sender)
                ),
                salt
            );
    }
}
