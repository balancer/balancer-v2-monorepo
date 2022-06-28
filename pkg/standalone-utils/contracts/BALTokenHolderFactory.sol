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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IBalancerToken.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IBALTokenHolderFactory.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";

import "./BALTokenHolder.sol";

contract BALTokenHolderFactory is IBALTokenHolderFactory {
    IBalancerToken private immutable _balancerToken;
    IVault private immutable _vault;

    mapping(address => bool) private _factoryCreatedHolders;

    event BALTokenHolderCreated(BALTokenHolder balTokenHolder, string name);

    constructor(IBalancerToken balancerToken, IVault vault) {
        _balancerToken = balancerToken;
        _vault = vault;
    }

    function getBalancerToken() public view override returns (IBalancerToken) {
        return _balancerToken;
    }

    function getVault() public view override returns (IVault) {
        return _vault;
    }

    function isHolderFromFactory(address holder) external view override returns (bool) {
        return _factoryCreatedHolders[holder];
    }

    function create(string memory name) external override returns (IBALTokenHolder) {
        BALTokenHolder holder = new BALTokenHolder(getBalancerToken(), getVault(), name);

        _factoryCreatedHolders[address(holder)] = true;
        emit BALTokenHolderCreated(holder, name);

        return holder;
    }
}
