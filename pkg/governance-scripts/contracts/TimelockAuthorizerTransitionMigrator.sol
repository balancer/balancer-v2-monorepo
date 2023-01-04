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

contract TimelockAuthorizerTransitionMigrator {
    using Address for address;

    TimelockAuthorizer public immutable timelockAuthorizer;

    struct RoleData {
        address grantee;
        bytes32 role;
        address target;
    }

    RoleData[] private _rolesData;
    bool private _migrationDone;

    /**
     * @dev Reverts if rolesData contains a role for an account which doesn't hold the same role on the old Authorizer.
     */
    constructor(
        IBasicAuthorizer oldAuthorizer,
        TimelockAuthorizer _timelockAuthorizer,
        RoleData[] memory rolesData
    ) {
        timelockAuthorizer = _timelockAuthorizer;

        for (uint256 i = 0; i < rolesData.length; i++) {
            RoleData memory roleData = rolesData[i];
            // We require that any permissions being copied from the old Authorizer must exist on the old Authorizer.
            // This simplifies verification of the permissions being added to the new TimelockAuthorizer.
            require(oldAuthorizer.canPerform(roleData.role, roleData.grantee, roleData.target), "UNEXPECTED_ROLE");
            _rolesData.push(roleData);
        }
    }

    /**
     * @notice Migrates permissions stored at contract creation time.
     * @dev Migration can only be performed once; calling this function will revert after the first call.
     */
    function migratePermissions() external {
        require(_migrationDone == false, "ALREADY_MIGRATED");
        _migrationDone = true;

        RoleData[] memory rolesData = _rolesData;

        for (uint256 i = 0; i < rolesData.length; i++) {
            RoleData memory roleData = rolesData[i];
            timelockAuthorizer.grantPermissions(_arr(roleData.role), roleData.grantee, _arr(roleData.target));
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
