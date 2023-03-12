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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/ISilo.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IShareToken.sol";

import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";

contract MockShareToken is TestToken, IShareToken {
    ISilo private immutable _silo;
    address private immutable _asset;

    /**
     * @dev Token is always deployed for specific Silo and asset
     * @param name token name
     * @param symbol token symbol
     * @param silo Silo address at which tokens were deployed
     * @param asset Asset for which these tokens were deployed
     */
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address silo,
        address asset
    ) TestToken(name, symbol, decimals) {
        _silo = ISilo(silo);
        _asset = asset;
    }

    function asset() external view override returns (address) {
        return _asset;
    }

    function silo() external view override returns (ISilo) {
        return _silo;
    }
}
