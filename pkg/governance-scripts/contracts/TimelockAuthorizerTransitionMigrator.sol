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

    RoleData[] internal rolesData;

    /**
     * @dev Reverts if _rolesData contains a role for an account which doesn't hold the same role on the old Authorizer.
     */
    constructor(
        IBasicAuthorizer _oldAuthorizer,
        TimelockAuthorizer _timelockAuthorizer,
        RoleData[] memory _rolesData
    ) {
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
     * @dev Permissions can only be granted by TimelockAuthorizer's root.
     */
    function migratePermissions() external {
        require(timelockAuthorizer.getRoot() == msg.sender, "UNAUTHORIZED_CALLER");

        RoleData[] memory _rolesData = rolesData;
        address timelockAuthorizerAddress = address(timelockAuthorizer);

        for (uint256 i = 0; i < _rolesData.length; i++) {
            RoleData memory roleData = _rolesData[i];

            bytes memory grantPermissionsCall = abi.encode(
                timelockAuthorizer.grantPermissions.selector,
                _arr(roleData.role),
                roleData.grantee,
                _arr(roleData.target)
            );
            // `grantPermissions` will only work when the caller is the root. Then, we use `delegateCall` so that
            // `msg.sender` is root in `grantPermissions`.
            timelockAuthorizerAddress.functionDelegateCall(grantPermissionsCall);
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
