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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "./interfaces/ISmartWalletChecker.sol";

contract SmartWalletChecker is ISmartWalletChecker, Authentication {

    IVault private immutable _vault;

    event ContractAddressAdded(address contractAddress);
    event ContractAddressRemoved(address contractAddress);

    mapping(address => bool) private _allowlistedAddresses;

    constructor(IVault vault, address[] memory initialAllowedAddresses) Authentication(bytes32(uint256(address(this)))) {
        // SmartWalletChecker is a singleton, so it simply uses its own address to disambiguate action identifiers
        _vault = vault;

        uint256 addressesLength = initialAllowedAddresses.length;
        for (uint256 i = 0; i < addressesLength; ++i) {
            _allowlistedAddresses[initialAllowedAddresses[i]] = true;
        }
    }

    function getVault() public view returns (IVault) {
        return _vault;
    }

    function getAuthorizer() public view returns (IAuthorizer) {
        return getVault().getAuthorizer();
    }

    function check(address contractAddress) view external override returns (bool) {
        return _allowlistedAddresses[contractAddress];
    }

    function allowlistAddress(address contractAddress) external authenticate {
        require(!_allowlistedAddresses[contractAddress], "Address already allowlisted");
        _allowlistedAddresses[contractAddress] = true;
        emit ContractAddressAdded(contractAddress);
    }

    function denylistAddress(address contractAddress) external authenticate {
        require(_allowlistedAddresses[contractAddress], "Address is not allowlisted");
        _allowlistedAddresses[contractAddress] = false;
        emit ContractAddressRemoved(contractAddress);
    }

    // Internal functions

    function _canPerform(bytes32 actionId, address account) internal view override returns (bool) {
        return getAuthorizer().canPerform(actionId, account, address(this));
    }
}
