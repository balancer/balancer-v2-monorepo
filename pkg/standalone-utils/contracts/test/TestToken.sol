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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20Burnable.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20Permit.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/AccessControl.sol";

contract TestToken is AccessControl, ERC20, ERC20Burnable, ERC20Permit {
    bytes32 public constant MINTER_PERMISSION = keccak256("MINTER_PERMISSION");

    constructor(
        address admin,
        string memory name,
        string memory symbol,
        uint8 decimals
    ) ERC20(name, symbol) ERC20Permit(name) {
        _setupDecimals(decimals);
        _setupAdmin(GLOBAL_PERMISSION_ADMIN, admin);
        _setupPermission(MINTER_PERMISSION, admin);
    }

    function mint(address recipient, uint256 amount) external {
        require(hasPermission(MINTER_PERMISSION, msg.sender, address(this)), "NOT_MINTER");
        _mint(recipient, amount);
    }
}
