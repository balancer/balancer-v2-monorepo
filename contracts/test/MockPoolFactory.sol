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

import "../pools/BasePoolFactory.sol";

contract MockFactoryCreatedPool {
    IVault public vault;

    constructor(IVault _vault) {
        vault = _vault;

        require(_vault.isAgentFor(address(0), address(this)), "Not a Universal Agent during construction");
    }
}

contract MockPoolFactory is BasePoolFactory {
    // solhint-disable-next-line no-empty-blocks
    constructor(IVault _vault) BasePoolFactory(_vault) {}

    function create(bytes32 salt) external returns (address) {
        return _create(abi.encodePacked(type(MockFactoryCreatedPool).creationCode, abi.encode(vault)), salt);
    }
}
