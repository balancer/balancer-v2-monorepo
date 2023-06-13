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
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-interfaces/contracts/vault/IBasicAuthorizer.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import "@balancer-labs/v2-vault/contracts/authorizer/TimelockAuthorizer.sol";

contract TimelockAuthorizerMigrator {
    bytes32
        public constant GENERAL_PERMISSION_SPECIFIER = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    // solhint-disable-previous-line max-line-length
    address public constant EVERYWHERE = address(-1);
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    IVault public immutable vault;
    address public immutable root;
    IBasicAuthorizer public immutable oldAuthorizer;
    TimelockAuthorizer public immutable newAuthorizer;
    uint256 public immutable changeRootDelay;

    uint256 private _lastScheduledExecutionId;

    struct RoleData {
        address grantee;
        bytes32 role;
        address target;
    }

    struct DelayData {
        bytes32 actionId;
        uint256 newDelay;
    }

    /**
     * @dev Reverts if _rolesData contains a role for an account which doesn't hold the same role on the old Authorizer.
     */
    constructor(
        address _root,
        IBasicAuthorizer _oldAuthorizer,
        IAuthorizerAdaptorEntrypoint _authorizerAdaptorEntrypoint,
        uint256 _changeRootDelay,
        RoleData[] memory _rolesData,
        RoleData[] memory _grantersData,
        RoleData[] memory _revokersData,
        DelayData[] memory _executeDelaysData,
        DelayData[] memory _grantDelaysData
    ) {
        // At creation, the migrator will be the root of the TimelockAuthorizer.
        // Once the migration is complete, the root permission will be transferred to `_root`.
        TimelockAuthorizer _newAuthorizer = new TimelockAuthorizer(
            address(this),
            _root,
            _authorizerAdaptorEntrypoint,
            _changeRootDelay
        );
        newAuthorizer = _newAuthorizer;
        oldAuthorizer = _oldAuthorizer;
        vault = _authorizerAdaptorEntrypoint.getVault();
        root = _root;
        changeRootDelay = _changeRootDelay;

        for (uint256 i = 0; i < _rolesData.length; i++) {
            RoleData memory roleData = _rolesData[i];
            // We require that any permissions being copied from the old Authorizer must exist on the old Authorizer.
            // This simplifies verification of the permissions being added to the new TimelockAuthorizer.
            require(_oldAuthorizer.canPerform(roleData.role, roleData.grantee, roleData.target), "UNEXPECTED_ROLE");
            _newAuthorizer.grantPermission(roleData.role, roleData.grantee, roleData.target);
        }
        for (uint256 i = 0; i < _grantersData.length; i++) {
            // There's no concept of a "granter" on the old Authorizer so we cannot verify these onchain.
            // We must manually verify that these permissions are set sensibly.
            _newAuthorizer.addGranter(_grantersData[i].role, _grantersData[i].grantee, _grantersData[i].target);
        }
        for (uint256 i = 0; i < _revokersData.length; i++) {
            // Similarly to granters, we must manually verify that these permissions are set sensibly.
            _newAuthorizer.addRevoker(_revokersData[i].grantee, _revokersData[i].target);
        }

        // We're going to schedule multiple actions, and we want to make sure we later execute them all. However, since
        // they're incrementing values all we need to do is store the last one, and then execute all ids up to that one
        // (including it).
        uint256 lastScheduledExecutionId = 0;

        // Setting the initial value for a delay requires us to wait 3 days before we can complete setting it.
        // We schedule them now to ensure that they're ready to execute once `changeRootDelay` has passed.
        for (uint256 i = 0; i < _executeDelaysData.length; i++) {
            // We're not wanting to set a delay greater than 1 month initially so fail early if we're doing so.
            require(_executeDelaysData[i].newDelay <= 30 days, "UNEXPECTED_LARGE_DELAY");
            lastScheduledExecutionId = _newAuthorizer.scheduleDelayChange(
                _executeDelaysData[i].actionId,
                _executeDelaysData[i].newDelay,
                _arr(address(this))
            );
        }
        for (uint256 i = 0; i < _grantDelaysData.length; i++) {
            // We're not wanting to set a delay greater than 1 month initially so fail early if we're doing so.
            require(_grantDelaysData[i].newDelay <= 30 days, "UNEXPECTED_LARGE_DELAY");

            lastScheduledExecutionId = _newAuthorizer.scheduleGrantDelayChange(
                _grantDelaysData[i].actionId,
                _grantDelaysData[i].newDelay,
                _arr(address(this))
            );
        }

        _lastScheduledExecutionId = lastScheduledExecutionId;
    }

    /**
     * @notice Executes the scheduled setup of delays on the new authorizer
     */
    function executeDelays() external {
        for (uint256 i = 0; i <= _lastScheduledExecutionId; i++) {
            newAuthorizer.execute(i);
        }
    }

    /**
     * @notice Complete the authorizer migration by updating the Vault to point to the new authorizer.
     * @dev `root` must call `claimRoot` on `newAuthorizer` before we update the Vault to point at it.
     */
    function finalizeMigration() external {
        // Safety check to avoid us migrating to a authorizer with an invalid root.
        // `root` must call `claimRoot` on `newAuthorizer` before we update the Vault to point at it.
        require(newAuthorizer.isRoot(root), "ROOT_NOT_CLAIMED_YET");

        // Ensure the migrator contract has authority to change the vault's authorizer
        bytes32 setAuthorizerId = IAuthentication(address(vault)).getActionId(IVault.setAuthorizer.selector);
        bool canSetAuthorizer = oldAuthorizer.canPerform(setAuthorizerId, address(this), address(vault));
        require(canSetAuthorizer, "MIGRATOR_CANNOT_SET_AUTHORIZER");

        // Finally change the authorizer in the vault.
        vault.setAuthorizer(newAuthorizer);
    }

    // Helper functions

    function _arr(bytes32 a) internal pure returns (bytes32[] memory arr) {
        arr = new bytes32[](1);
        arr[0] = a;
    }

    function _arr(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }
}
