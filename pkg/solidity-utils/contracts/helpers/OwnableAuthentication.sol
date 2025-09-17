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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "../openzeppelin/Ownable2Step.sol";
import "../openzeppelin/Ownable.sol";
import "./Authentication.sol";

/**
 * @notice OwnableAuthentication is a contract that combines ownership management with authentication.
 * @dev Use it to pre-wire admin multisigs upon deployment to a contract that requires permissioned functions to work,
 * where the impact of the owner going rogue is minimal. Contract registries, fee burners, and other utility contracts
 * are good examples.
 * In turn, the pre-configured owner can speed up operations as it can perform any action right after deployment without
 * waiting for governance to set up the authorizer, which can take whole weeks.
 * On the other hand, governance can always revoke or change the owner at any given time, keeping superior powers
 * above the owner.
 */
contract OwnableAuthentication is Ownable2Step, Authentication {
    IVault public immutable vault;

    constructor(IVault vault_, address initialOwner)
        Ownable(initialOwner)
        Authentication(bytes32(uint256(uint160(address(this)))))
    {
        _require(address(vault_) != address(0), Errors.VAULT_NOT_SET);

        vault = vault_;
    }

    /// @notice Returns the authorizer address according to the Vault.
    function getAuthorizer() external view returns (IAuthorizer) {
        return vault.getAuthorizer();
    }

    /**
     * @notice Transfer ownership without the 2-step process. It cannot be called by the current owner; governance only.
     * @dev This allows governance to revoke the owner at any time, preserving control above the owner at all times.
     * address(0) is also a valid owner, as governance can simply choose to revoke ownership.
     * Ownership can always be forced back to any address later on.
     */
    function forceTransferOwnership(address newOwner) external authenticate {
        // `authenticate` lets the owner through, so we filter it out here.
        _require(msg.sender != owner(), Errors.SENDER_NOT_ALLOWED);

        _transferOwnership(newOwner);
    }

    function _canPerform(bytes32 actionId, address user) internal view virtual override returns (bool) {
        // The owner is always allowed to perform any action.
        if (user == owner()) {
            return true;
        }

        // Otherwise, check the vault's authorizer for permission.
        return vault.getAuthorizer().canPerform(actionId, user, address(this));
    }
}
