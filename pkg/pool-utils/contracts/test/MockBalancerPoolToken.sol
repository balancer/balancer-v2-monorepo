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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "../BalancerPoolToken.sol";

contract MockBalancerPoolToken is BalancerPoolToken {
    constructor(
        string memory name,
        string memory symbol,
        IVault vault
    ) BalancerPoolToken(name, symbol, vault) {}

    function mint(address recipient, uint256 amount) external {
        _mintPoolTokens(recipient, amount);
    }

    function burn(address sender, uint256 amount) external {
        _burnPoolTokens(sender, amount);
    }
}
