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
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-vault/contracts/authorizer/TimelockAuthorizer.sol";

/**
 * @notice Migrates permissions granted after `TimelockAuthorizer` deployment from the old authorizer.
 */
contract TimelockAuthorizerTransitionMigrator {
    using Address for address;

    event PermissionSkipped(bytes32 indexed role, address indexed grantee, address indexed target);

    IBasicAuthorizer public immutable oldAuthorizer;
    TimelockAuthorizer public immutable timelockAuthorizer;
    RoleData[] public rolesData;
    uint256[] public scheduledExecutionIds;

    struct RoleData {
        address grantee;
        bytes32 role;
        address target;
    }

    bool private _migrationCompleted;

    /**
     * @dev Reverts if rolesData contains a role for an account which doesn't hold the same role on the old Authorizer.
     */
    constructor(
        IBasicAuthorizer _oldAuthorizer,
        TimelockAuthorizer _timelockAuthorizer,
        RoleData[] memory _rolesData
    ) {
        oldAuthorizer = _oldAuthorizer;
        timelockAuthorizer = _timelockAuthorizer;

        for (uint256 i = 0; i < _rolesData.length; i++) {
            RoleData memory roleData = _rolesData[i];
            // We require that any permissions being copied from the old Authorizer must exist on the old Authorizer.
            // This simplifies verification of the permissions being added to the new TimelockAuthorizer.
            require(_oldAuthorizer.canPerform(roleData.role, roleData.grantee, roleData.target), "UNEXPECTED_ROLE");
            rolesData.push(roleData);
        }
    }

    /**
     * @notice Migrates permissions stored at contract creation time.
     * @dev Migration can only be performed once; calling this function will revert after the first call.
     * The contract needs to be a general granter for the call to succeed, otherwise it will revert when attempting
     * to call `grantPermissions` on `TimelockAuthorizer`.
     * Anyone can trigger the migration, but only TimelockAuthorizer's root can make this contract a granter.
     * We check each permission stored at deployment time once more against the old authorizer, and only
     * migrate those that remain in effect. If a permission was revoked in the time between deployment and calling
     * `migrationPermissions`, emit a `PermissionSkipped` event instead.
     * The contract renounces to its granter permissions after finishing.
     */
    function migratePermissions() external {
        require(!_migrationCompleted, "ALREADY_MIGRATED");
        _migrationCompleted = true;

        uint256 rolesDataLength = rolesData.length;
        address[] memory executors = _arr(address(this));

        for (uint256 i = 0; i < rolesDataLength; ++i) {
            RoleData memory roleData = rolesData[i];
            // Before granting permissions, we check with the old authorizer again in case any permissions were
            // revoked since the contract creation time.
            // The timelock authorizer will emit an event for each permission granted, so we just log the ones we are
            // skipping (if any).
            if (oldAuthorizer.canPerform(roleData.role, roleData.grantee, roleData.target)) {
                // Check whether the current action has a delay
                bytes32 roleGrantPermissionActionId = timelockAuthorizer.getGrantPermissionActionId(roleData.role);
                if (timelockAuthorizer.getActionIdDelay(roleGrantPermissionActionId) == 0) {
                    timelockAuthorizer.grantPermissions(_arr(roleData.role), roleData.grantee, _arr(roleData.target));
                } else {
                    uint256 permissionId = timelockAuthorizer.scheduleGrantPermission(
                        roleData.role,
                        roleData.grantee,
                        roleData.target,
                        executors
                    );
                    scheduledExecutionIds.push(permissionId);
                }
            } else {
                emit PermissionSkipped(roleData.role, roleData.grantee, roleData.target);
            }
        }

        timelockAuthorizer.manageGranter(
            timelockAuthorizer.GENERAL_PERMISSION_SPECIFIER(),
            address(this),
            timelockAuthorizer.EVERYWHERE(),
            false
        );
    }

    /**
     * @notice Executes permissions scheduled during migration, all at once.
     * @dev `migratePermissions` must be called successfully first.
     * Execution IDs that cannot be executed at this time for any reason (delay not yet due, action was canceled, or
     * action already executed) are skipped.
     *
     * This function can be called more than once without reverting. The execution IDs may have different delays
     * associated with them, and this function can execute a subset of the execution IDs if it is called before the
     * longest delay is due.
     *
     * On the other hand, this function can still be called after all scheduled execution IDs are resolved (either
     * cancelled or executed). In that case the function call will do nothing, since the `TimelockAuthorizer` will not
     * allow any execution.
     */
    function executeDelays() external {
        require(_migrationCompleted, "MIGRATION_INCOMPLETE");

        uint256 scheduledExecutionIdsLength = scheduledExecutionIds.length;
        for (uint256 i = 0; i < scheduledExecutionIdsLength; ++i) {
            uint256 scheduledExecutionId = scheduledExecutionIds[i];
            if (timelockAuthorizer.canExecute(scheduledExecutionId)) {
                timelockAuthorizer.execute(scheduledExecutionId);
            }
        }
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
