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
    address public constant EVERYWHERE = address(-1);
    uint256 public constant CHANGE_ROOT_DELAY = 7 days;
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    // solhint-disable var-name-mixedcase
    bytes32 public immutable GRANT_PERMISSION_ACTION_ID;
    bytes32 public immutable REVOKE_PERMISSION_ACTION_ID;

    IVault public immutable vault;
    IBasicAuthorizer public immutable oldAuthorizer;
    TimelockAuthorizer public immutable newAuthorizer;

    uint256 public migratedRoles;
    OldRoleData[] public rolesData;

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
        IBasicAuthorizer _oldAuthorizer,
        OldRoleData[] memory _rolesData
    ) {
        TimelockAuthorizer _newAuthorizer = new TimelockAuthorizer(address(this), _vault, CHANGE_ROOT_DELAY);
        newAuthorizer = _newAuthorizer;
        oldAuthorizer = _oldAuthorizer;
        vault = _vault;

        for (uint256 i = 0; i < _rolesData.length; i++) {
            rolesData.push(OldRoleData(_rolesData[i].role, _rolesData[i].target));
        }

        bytes32 id = bytes32(uint256(address(_newAuthorizer)));
        GRANT_PERMISSION_ACTION_ID = keccak256(abi.encodePacked(id, TimelockAuthorizer.grantPermissions.selector));
        REVOKE_PERMISSION_ACTION_ID = keccak256(abi.encodePacked(id, TimelockAuthorizer.revokePermissions.selector));
    }

    /**
     * @dev Migrate roles from the old authorizer to the new one
     * @param n Number of roles to migrate, use 0 to migrate all the remaining ones
     */
    function migrate(uint256 n) external {
        _beforeMigrate();
        _migrate(n == 0 ? rolesData.length : n);
        _afterMigrate();
    }

    function _migrate(uint256 n) internal {
        uint256 i = migratedRoles;
        uint256 to = Math.min(i + n, rolesData.length);
        for (; i < to; i++) _migrate(rolesData[i]);
        migratedRoles = i;
    }

    function _migrate(OldRoleData memory roleData) internal {
        // In the old authorizer, each role has an admin role which might have been granted to many admins.
        // In order to replicate that in the new authorizer, we need to grant permission for
        // `TimelockAuthorizer.grantPermissions` to the same list of admins on each target.
        // First, the contract iterates over the accounts that had the role granted in the old authorizer, granting
        // the permission for the same role for the specified target in the new authorizer.
        _migrate(roleData.role, roleData.target);

        // Finally, the contract iterates over the list of role admins to grant `TimelockAuthorizer.grantPermissions`
        // over the specified target. Note that this step may overlap with other roles data since this permission
        // is at a general level for each target and not at a per-action level. However, the new authorizer ignores
        // the request if the permission was granted already.
        bytes32 adminRole = oldAuthorizer.getRoleAdmin(roleData.role);
        _migrate(adminRole, roleData.target);
    }

    function _migrate(bytes32 role, address target) internal {
        address[] memory wheres = _arr(target);
        bytes32[] memory actionIds = _arr(role);
        uint256 membersCount = oldAuthorizer.getRoleMemberCount(role);
        for (uint256 i = 0; i < membersCount; i++) {
            address member = oldAuthorizer.getRoleMember(role, i);
            newAuthorizer.grantPermissions(actionIds, member, wheres);
        }
    }

    function _beforeMigrate() internal view {
        // Execute only once before the migration starts
        if (migratedRoles > 0) return;

        // Ensure the migrator contract has authority to change the vault's authorizer
        bytes32 setAuthorizerId = IAuthentication(address(vault)).getActionId(IVault.setAuthorizer.selector);
        bool canSetAuthorizer = oldAuthorizer.canPerform(setAuthorizerId, address(this), address(vault));
        require(canSetAuthorizer, "MIGRATOR_CANNOT_SET_AUTHORIZER");
    }

    function _afterMigrate() internal {
        // Execute only once after the migration ends
        if (migratedRoles < rolesData.length) return;

        // Grant permissions for `TimelockAuthorizer.grantPermissions` and `TimelockAuthorizer.revokePermissions`
        // on `TimelockAuthorizer.EVERYWHERE` to all the default admins defined in the old authorizer, and revoke
        // these permissions to the migrator contract that were granted during initialization.
        address[] memory wheres = _arr(EVERYWHERE, EVERYWHERE);
        bytes32[] memory actionIds = _arr(GRANT_PERMISSION_ACTION_ID, REVOKE_PERMISSION_ACTION_ID);
        uint256 defaultAdminsCount = oldAuthorizer.getRoleMemberCount(DEFAULT_ADMIN_ROLE);
        for (uint256 i = 0; i < defaultAdminsCount; i++) {
            address defaultAdmin = oldAuthorizer.getRoleMember(DEFAULT_ADMIN_ROLE, i);
            newAuthorizer.grantPermissions(actionIds, defaultAdmin, wheres);
        }
        newAuthorizer.revokePermissions(actionIds, address(this), wheres);

        // Finally change the authorizer in the vault
        vault.setAuthorizer(newAuthorizer);
    }

    function _times(bytes32 a, uint256 n) internal pure returns (bytes32[] memory arr) {
        arr = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) arr[i] = a;
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
