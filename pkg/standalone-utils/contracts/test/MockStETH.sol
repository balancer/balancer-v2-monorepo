// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2015, 2016, 2017 Dapphub

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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IstETH.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";

contract MockStETH is TestToken, IstETH {
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals
    ) TestToken(name, symbol, decimals) {
        // solhint-disable-previous-line no-empty-blocks
    }

    event EthStaked(uint256 amount);

    function submit(address) external payable override returns (uint256) {
        _mint(msg.sender, msg.value);
        emit EthStaked(msg.value);
        return msg.value;
    }
}
