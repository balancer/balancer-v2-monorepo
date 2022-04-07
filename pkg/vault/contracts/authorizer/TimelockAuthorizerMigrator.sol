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

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import "./IBasicAuthorizer.sol";
import "./TimelockAuthorizer.sol";
import "../interfaces/IVault.sol";

contract TimelockAuthorizerMigrator {
    bytes32 public constant WHATEVER = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    address public constant EVERYWHERE = address(-1);
    uint256 public constant CHANGE_ROOT_DELAY = 7 days;
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    // solhint-disable var-name-mixedcase
    bytes32 public immutable GRANT_PERMISSION_ACTION_ID;
    bytes32 public immutable REVOKE_PERMISSION_ACTION_ID;

    IVault public immutable vault;
    address public immutable root;
    IBasicAuthorizer public immutable oldAuthorizer;
    TimelockAuthorizer public immutable newAuthorizer;

    uint256 public migratedRoles;
    OldRoleData[] public rolesData;
    uint256 public rootChangeExecutionId;

    /**
     * @dev This structure is required to tell the migrator which roles need to be
     * granted for which targets in the new timelock authorizer.
     */
    struct OldRoleData {
        bytes32 role;
        address target;
    }

    constructor(
        IVault _vault,
        address _root,
        IBasicAuthorizer _oldAuthorizer,
        OldRoleData[] memory _rolesData
    ) {
        // At creation, the migrator will be the root of the TimelockAuthorizer.
        // Once the migration is complete, the root permission will be transferred to `_root`.
        TimelockAuthorizer _newAuthorizer = new TimelockAuthorizer(address(this), _vault, CHANGE_ROOT_DELAY);
        newAuthorizer = _newAuthorizer;
        oldAuthorizer = _oldAuthorizer;
        root = _root;
        vault = _vault;

        for (uint256 i = 0; i < _rolesData.length; i++) {
            rolesData.push(OldRoleData(_rolesData[i].role, _rolesData[i].target));
        }

        bytes32 id = bytes32(uint256(address(_newAuthorizer)));
        GRANT_PERMISSION_ACTION_ID = keccak256(abi.encodePacked(id, TimelockAuthorizer.grantPermissions.selector));
        REVOKE_PERMISSION_ACTION_ID = keccak256(abi.encodePacked(id, TimelockAuthorizer.revokePermissions.selector));
    }

    /**
     * @dev Tells whether the migration has been completed or not
     */
    function isComplete() public view returns (bool) {
        return migratedRoles >= rolesData.length;
    }

    /**
     * @dev Migrate roles from the old authorizer to the new one
     * @param n Number of roles to migrate, use 0 to migrate all the remaining ones
     */
    function migrate(uint256 n) external {
        require(!isComplete(), "MIGRATION_COMPLETE");
        _beforeMigrate();
        _migrate(n == 0 ? rolesData.length : n);
        _afterMigrate();
    }

    /**
     * @dev Revoke migrator permissions and trigger change root action
     */
    function finalizeMigration() external {
        require(isComplete(), "MIGRATION_NOT_COMPLETE");
        require(newAuthorizer.canExecute(rootChangeExecutionId), "CANNOT_TRIGGER_ROOT_CHANGE_YET");

        // Ensure the migrator contract has authority to change the vault's authorizer
        bytes32 setAuthorizerId = IAuthentication(address(vault)).getActionId(IVault.setAuthorizer.selector);
        bool canSetAuthorizer = oldAuthorizer.canPerform(setAuthorizerId, address(this), address(vault));
        require(canSetAuthorizer, "MIGRATOR_CANNOT_SET_AUTHORIZER");

        // Finally change the authorizer in the vault and trigger root change
        vault.setAuthorizer(newAuthorizer);
        newAuthorizer.execute(rootChangeExecutionId);
    }

    function _migrate(uint256 n) internal {
        uint256 i = migratedRoles;
        uint256 to = Math.min(i + n, rolesData.length);
        for (; i < to; i++) _migrate(rolesData[i]);
        migratedRoles = i;
    }

    function _migrate(OldRoleData memory roleData) internal {
        _migrate(roleData.role, roleData.target);
        _migrate(oldAuthorizer.getRoleAdmin(roleData.role), roleData.target);
    }

    function _migrate(bytes32 role, address target) internal {
        address[] memory wheres = _arr(target);
        bytes32[] memory actionIds = _arr(role);
        uint256 membersCount = oldAuthorizer.getRoleMemberCount(role);

        // Iterate over the accounts that had the role granted in the old authorizer, granting
        // the permission for the same role for the specified target in the new authorizer.
        for (uint256 i = 0; i < membersCount; i++) {
            address member = oldAuthorizer.getRoleMember(role, i);
            newAuthorizer.grantPermissions(actionIds, member, wheres);
        }
    }

    function _beforeMigrate() internal {
        // Execute only once before the migration starts
        if (migratedRoles > 0) return;

        // Enqueue a root change execution in the new authorizer to set it to the desire root address
        rootChangeExecutionId = newAuthorizer.scheduleRootChange(root, _arr(address(this)));
    }

    function _afterMigrate() internal {
        // Execute only once after the migration ends
        if (!isComplete()) return;

        // Grant permissions for `TimelockAuthorizer.grantPermissions` and `TimelockAuthorizer.revokePermissions`
        // on `TimelockAuthorizer.EVERYWHERE` and `TimelockAuthorizer.WHATEVER` to all the default admins defined
        // in the old authorizer
        bytes32 grantWhateverActionId = newAuthorizer.getActionId(GRANT_PERMISSION_ACTION_ID, WHATEVER);
        bytes32 revokeWhateverActionId = newAuthorizer.getActionId(REVOKE_PERMISSION_ACTION_ID, WHATEVER);
        bytes32[] memory actionIds = _arr(grantWhateverActionId, revokeWhateverActionId);
        address[] memory wheres = _arr(EVERYWHERE, EVERYWHERE);
        uint256 defaultAdminsCount = oldAuthorizer.getRoleMemberCount(DEFAULT_ADMIN_ROLE);
        for (uint256 i = 0; i < defaultAdminsCount; i++) {
            address defaultAdmin = oldAuthorizer.getRoleMember(DEFAULT_ADMIN_ROLE, i);
            newAuthorizer.grantPermissions(actionIds, defaultAdmin, wheres);
        }
        newAuthorizer.revokePermissions(actionIds, address(this), wheres);
    }

    function _arr(bytes32 a) internal pure returns (bytes32[] memory arr) {
        arr = new bytes32[](1);
        arr[0] = a;
    }

    function _arr(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory arr) {
        arr = new bytes32[](2);
        arr[0] = a;
        arr[1] = b;
    }

    function _arr(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }

    function _arr(address a, address b) internal pure returns (address[] memory arr) {
        arr = new address[](2);
        arr[0] = a;
        arr[1] = b;
    }
}
