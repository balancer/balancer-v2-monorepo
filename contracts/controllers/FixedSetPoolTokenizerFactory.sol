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

import "@openzeppelin/contracts/utils/Create2.sol";

import "../vault/IVault.sol";

import "./FixedSetPoolTokenizer.sol";

contract FixedSetPoolTokenizerFactory {
    IVault immutable vault;

    event FixedSetPoolTokenizerCreated(address indexed tokenizer);

    constructor(IVault _vault) {
        vault = _vault;
    }

    function create(
        address strategy,
        IVault.StrategyType strategyType,
        bytes32 salt
    ) external returns (address) {
        bytes memory creationCode = _getCreationCode(strategy, strategyType);

        address expectedDestination = Create2.computeAddress(
            salt,
            keccak256(creationCode)
        );

        //vault.reportTrustedOperator(expectedDestination);

        address tokenizer = Create2.deploy(0, salt, creationCode);
        assert(tokenizer == expectedDestination);

        emit FixedSetPoolTokenizerCreated(tokenizer);

        return tokenizer;
    }

    function _getCreationCode(
        address strategy,
        IVault.StrategyType strategyType
    ) private view returns (bytes memory) {
        return
            abi.encodePacked(
                type(FixedSetPoolTokenizer).creationCode,
                abi.encode(vault, strategy, strategyType)
            );
    }
}
