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

import "./TimelockAuthorizer.sol";

contract TimelockAuthorizerMigrator {
    bytes32 public constant WHATEVER = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    address public constant EVERYWHERE = address(-1);
    uint256 public constant CHANGE_ROOT_DELAY = 7 days;
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    IVault public immutable vault;
    address public immutable root;
    IBasicAuthorizer public immutable oldAuthorizer;
    TimelockAuthorizer public immutable newAuthorizer;

    bool private _roleMigrationComplete;
    uint256 public rootChangeExecutionId;

    uint256 public existingRolesMigrated;
    RoleData[] public rolesData;

    uint256 public grantersMigrated;
    RoleData[] public grantersData;

    uint256 public revokersMigrated;
    RoleData[] public revokersData;

    // As execution IDs are sequential and these are the first scheduled executions, we just need to iterate from 0
    // to the maximum execution ID rather than maintaining an array.
    uint256 public delaysSet;
    uint256 public delaysExecutions;

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
        IVault _vault,
        address _root,
        IBasicAuthorizer _oldAuthorizer,
        RoleData[] memory _rolesData,
        RoleData[] memory _grantersData,
        RoleData[] memory _revokersData,
        DelayData[] memory _executeDelaysData,
        DelayData[] memory _grantDelaysData
    ) {
        // At creation, the migrator will be the root of the TimelockAuthorizer.
        // Once the migration is complete, the root permission will be transferred to `_root`.
        TimelockAuthorizer _newAuthorizer = new TimelockAuthorizer(address(this), _vault, CHANGE_ROOT_DELAY);
        newAuthorizer = _newAuthorizer;
        oldAuthorizer = _oldAuthorizer;
        root = _root;
        vault = _vault;

        for (uint256 i = 0; i < _rolesData.length; i++) {
            RoleData memory roleData = _rolesData[i];
            // We require that any permissions being copied from the old Authorizer must exist on the old Authorizer.
            // This simplifies verification of the permissions being added to the new TimelockAuthorizer.
            require(_oldAuthorizer.canPerform(roleData.role, roleData.grantee, roleData.target), "UNEXPECTED_ROLE");
            rolesData.push(roleData);
        }
        for (uint256 i = 0; i < _grantersData.length; i++) {
            // There's no concept of a "granter" on the old Authorizer so we cannot verify these onchain.
            // We must manually verify that these permissions are set sensibly.
            grantersData.push(_grantersData[i]);
        }
        for (uint256 i = 0; i < _revokersData.length; i++) {
            // Similarly to granters, we must manually verify that these permissions are set sensibly.
            revokersData.push(_revokersData[i]);
        }

        // We require for there to be at least one delay set as we use the number of delays set as a test for whether
        // the migration is complete. Deploying the migrator with an empty delays array results in a broken deploy.
        uint256 delaysDataLength = _executeDelaysData.length + _grantDelaysData.length;
        require(delaysDataLength > 0, "INVALID_DELAYS_LENGTH");
        delaysExecutions = delaysDataLength;

        // Setting the initial value for a delay requires us to wait 3 days before we can complete setting it.
        // As we're only setting a small number of delays we then schedule them now to ensure that they're ready
        // to execute once `CHANGE_ROOT_DELAY` has passed.
        for (uint256 i = 0; i < _executeDelaysData.length; i++) {
            // We're not wanting to set a delay greater than 1 month initially so fail early if we're doing so.
            require(_executeDelaysData[i].newDelay <= 30 days, "UNEXPECTED_LARGE_DELAY");
            _newAuthorizer.scheduleDelayChange(
                _executeDelaysData[i].actionId,
                _executeDelaysData[i].newDelay,
                _arr(address(this))
            );
        }
        bytes32 grantActionId = _newAuthorizer.GRANT_ACTION_ID();
        for (uint256 i = 0; i < _grantDelaysData.length; i++) {
            // We're not wanting to set a delay greater than 1 month initially so fail early if we're doing so.
            require(_grantDelaysData[i].newDelay <= 30 days, "UNEXPECTED_LARGE_DELAY");
            _newAuthorizer.scheduleDelayChange(
                _newAuthorizer.getActionId(grantActionId, _grantDelaysData[i].actionId),
                _grantDelaysData[i].newDelay,
                _arr(address(this))
            );
        }

        // Enqueue a root change execution in the new authorizer to set it to the desired root address.
        // We only allow the migrator to execute this transaction to avoid it being triggered too early,
        // resulting in the migration being cut short.
        rootChangeExecutionId = _newAuthorizer.scheduleRootChange(_root, _arr(address(this)));
    }

    /**
     * @notice Returns whether the migration has been completed or not
     */
    function isComplete() public view returns (bool) {
        return _roleMigrationComplete;
    }

    /**
     * @dev Migrate roles from the old authorizer to the new one
     * @param rolesToMigrate Number of roles to migrate, use MAX_UINT256 to migrate all the remaining ones
     */
    function migrate(uint256 rolesToMigrate) external {
        require(!isComplete(), "MIGRATION_COMPLETE");
        _migrate(rolesToMigrate);
        _afterMigrate();
    }

    /**
     * @dev Revoke migrator permissions and trigger change root action
     */
    function finalizeMigration() external {
        require(isComplete(), "MIGRATION_NOT_COMPLETE");
        // Safety check to avoid us migrating to a authorizer with an invalid root.
        // `root` must call `claimRoot` on `newAuthorizer` in order for us to set it on the Vault.
        require(newAuthorizer.isRoot(root), "ROOT_NOT_CLAIMED_YET");

        // Ensure the migrator contract has authority to change the vault's authorizer
        bytes32 setAuthorizerId = IAuthentication(address(vault)).getActionId(IVault.setAuthorizer.selector);
        bool canSetAuthorizer = oldAuthorizer.canPerform(setAuthorizerId, address(this), address(vault));
        require(canSetAuthorizer, "MIGRATOR_CANNOT_SET_AUTHORIZER");

        // Finally change the authorizer in the vault and trigger root change
        vault.setAuthorizer(newAuthorizer);
    }

    // Internal Functions

    /**
     * @notice Migrates to TimelockAuthorizer by setting up roles from the old Authorizer and new granters/revokers.
     * @dev Attempting to migrate roles more than the amount of unmigrated roles of any particular type results in
     * all remaining roles of that type being migrated. The unused role migrations will then flow over into the next
     * "role type".
     * @param rolesToMigrate The number of permissions to set up on the new TimelockAuthorizer.
     */
    function _migrate(uint256 rolesToMigrate) internal {
        // Each function returns the amount of unused role migrations which is then fed into the next function.
        rolesToMigrate = _migrateExistingRoles(rolesToMigrate);
        rolesToMigrate = _setupGranters(rolesToMigrate);
        rolesToMigrate = _setupRevokers(rolesToMigrate);
        _setupDelays(rolesToMigrate);

        // As we execute the setting of delays last we can use them to determine whether the full migration is complete.
        if (delaysSet >= delaysExecutions) {
            _roleMigrationComplete = true;
        }
    }

    /**
     * @notice Migrates listed roles from the old Authorizer to the new TimelockAuthorizer.
     * @dev Attempting to migrate roles more than the unmigrated roles results in all remaining roles being migrated.
     * The amount of unused role migrations is then returned so they can be used to perform the next migration step.
     * @param rolesToMigrate - The desired number of roles to migrate (may exceed the remaining unmigrated roles).
     * @return remainingRolesToMigrate - The amount of role migrations which were unused in this function.
     */
    function _migrateExistingRoles(uint256 rolesToMigrate) internal returns (uint256 remainingRolesToMigrate) {
        uint256 i = existingRolesMigrated;
        uint256 to = Math.min(i + rolesToMigrate, rolesData.length);
        remainingRolesToMigrate = (i + rolesToMigrate) - to;

        for (; i < to; i++) {
            RoleData memory roleData = rolesData[i];
            newAuthorizer.grantPermissions(_arr(roleData.role), roleData.grantee, _arr(roleData.target));
        }

        existingRolesMigrated = i;
    }

    /**
     * @notice Sets up granters for the listed roles on the new TimelockAuthorizer.
     * @dev Attempting to migrate roles more than the unmigrated roles results in all remaining roles being migrated.
     * The amount of unused role migrations is then returned so they can be used to perform the next migration step.
     * @param rolesToMigrate - The desired number of roles to migrate (may exceed the remaining unmigrated roles).
     * @return remainingRolesToMigrate - The amount of role migrations which were unused in this function.
     */
    function _setupGranters(uint256 rolesToMigrate) internal returns (uint256 remainingRolesToMigrate) {
        uint256 i = grantersMigrated;
        uint256 to = Math.min(i + rolesToMigrate, grantersData.length);
        remainingRolesToMigrate = (i + rolesToMigrate) - to;

        for (; i < to; i++) {
            RoleData memory granterData = grantersData[i];
            newAuthorizer.manageGranter(granterData.role, granterData.grantee, granterData.target, true);
        }

        grantersMigrated = i;
    }

    /**
     * @notice Sets up revokers for the listed roles on the new TimelockAuthorizer.
     * @dev Attempting to migrate roles more than the unmigrated roles results in all remaining roles being migrated.
     * @param rolesToMigrate - The desired number of roles to migrate (may exceed the remaining unmigrated roles).
     */
    function _setupRevokers(uint256 rolesToMigrate) internal returns (uint256 remainingRolesToMigrate) {
        uint256 i = revokersMigrated;
        uint256 to = Math.min(i + rolesToMigrate, revokersData.length);
        remainingRolesToMigrate = (i + rolesToMigrate) - to;

        for (; i < to; i++) {
            RoleData memory revokerData = revokersData[i];
            newAuthorizer.manageRevoker(revokerData.role, revokerData.grantee, revokerData.target, true);
        }

        revokersMigrated = i;
    }

    /**
     * @notice Executes the setting of listed delays on the new TimelockAuthorizer.
     * @dev Attempting to execute more than the number of unexecuted delays results in all remaining delays being set.
     * @param delaysToSet - The desired number of scheduled delays to execute (may exceed the remaining delays).
     */
    function _setupDelays(uint256 delaysToSet) internal {
        uint256 i = delaysSet;
        uint256 to = Math.min(i + delaysToSet, delaysExecutions);

        // The first delay will be the longest (by definition as it is the delay for changing the authorizer address)
        // We then just need to check this once to know that the other delays may be set.
        if (i == 0) require(newAuthorizer.canExecute(0), "CANNOT_TRIGGER_DELAY_CHANGE_YET");

        for (; i < to; i++) {
            newAuthorizer.execute(i);
        }

        delaysSet = i;
    }

    /**
     * @notice Begins transfer of root powers from the migrator to the specified address once all roles are migrated.
     */
    function _afterMigrate() internal {
        // Execute only once after the migration ends
        if (!isComplete()) return;

        // Finally trigger the first step of transferring root ownership over the TimelockAuthorizer to `root`.
        // Before the migration can be finalized, `root` must call `claimRoot` on the `TimelockAuthorizer`.
        require(newAuthorizer.canExecute(rootChangeExecutionId), "CANNOT_TRIGGER_ROOT_CHANGE_YET");
        newAuthorizer.execute(rootChangeExecutionId);
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
