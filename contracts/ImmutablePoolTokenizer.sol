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

import "./vault/IVault.sol";
import "./BasePoolTokenizer.sol";

// Initial implementation implements a simple, pass-through sole proprietorship model
// for pool governance
contract ImmutablePoolTokenizer is BasePoolTokenizer {
    address public creator;

    constructor(
        IVault _vault,
        bytes32 _poolID // swap fee etc
    ) BasePoolTokenizer(_vault) {
        poolID = _poolID;
        creator = msg.sender;
    }

    function initPool(
        uint256 initialBPT,
        address[] calldata initialTokens,
        uint256[] calldata initialBalances
    ) external {
        require(msg.sender == creator, "creator must initialize pool");
        _addInitialLiquidity(initialBPT, initialTokens, initialBalances);
    }
}
