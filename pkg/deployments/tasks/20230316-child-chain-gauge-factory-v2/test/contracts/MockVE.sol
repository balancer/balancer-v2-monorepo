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

pragma solidity ^0.7.0;

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IVeDelegation.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/ERC20Mock.sol";

// For compatibility, we're keeping the same function names as in the original Curve code, including the mixed-case
// naming convention.
// solhint-disable var-name-mixedcase

contract MockVE is ERC20Mock {
    mapping(address => uint256) public locked__end;

    constructor() ERC20Mock("Mock Bridged VE", "mveBAL") {
        // solhint-disable-previous-line no-empty-blocks
    }

    function setLockedEnd(address user, uint256 end) external {
        locked__end[user] = end;
    }
}
