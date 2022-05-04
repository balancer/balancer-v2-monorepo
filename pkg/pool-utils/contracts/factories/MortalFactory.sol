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
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

/**
 * @author Balancer Labs
 * @title Give governance the ability to disable a given factory.
 * @dev This can be used to deprecate a factory (e.g., one that doesn't charge protocol fees) once it has been
 * superceded by a new version.
 */
abstract contract MortalFactory is Authentication {
    IVault private immutable _vault;

    bool private _disabled;

    event FactoryDisabled();

    // Factories should be singletons, so use the address of the derived contract (this)
    // to disambiguate action identifiers.
    constructor(IVault vault) Authentication(bytes32(uint256(address(this)))) {
        _vault = vault;
    }

    /**
     * @dev Check whether the derived factory has been disabled.
     */
    function isDisabled() public view returns (bool) {
        return _disabled;
    }

    /**
     * @dev Disable the factory. Can only be called once, by authorized accounts. Sets the `_disabled` flag to indicate
     * that no further pools should be created using this factory.
     */
    function disable() external authenticate {
        // prevent generating multiple events
        _ensureEnabled();

        _disabled = true;

        emit FactoryDisabled();
    }

    // Derived factories should call this in their `create` functions to revert if the factory is disabled.
    function _ensureEnabled() internal view {
        _require(!isDisabled(), Errors.DISABLED);
    }

    function _canPerform(bytes32 actionId, address user) internal view override returns (bool) {
        return (_vault.getAuthorizer().canPerform(actionId, user, address(this)));
    }
}
