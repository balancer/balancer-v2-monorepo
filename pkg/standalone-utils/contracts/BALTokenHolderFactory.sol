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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-gauges/contracts/interfaces/IBalancerToken.sol";

import "./BALTokenHolder.sol";
import "./interfaces/IBALTokenHolderFactory.sol";

contract BALTokenHolderFactory is IBALTokenHolderFactory {
    IBalancerToken private immutable _balancerToken;
    IVault private immutable _vault;

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

    function create(string memory name) external override returns (IBALTokenHolder) {
        BALTokenHolder holder = new BALTokenHolder(getBalancerToken(), getVault(), name);
        emit BALTokenHolderCreated(holder, name);

        return holder;
    }
}
