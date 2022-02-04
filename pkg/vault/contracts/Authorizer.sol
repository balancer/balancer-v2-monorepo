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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";

import "./interfaces/IAuthorizer.sol";

/**
 * @dev Basic Authorizer implementation, based on OpenZeppelin's Access Control.
 *
 * Users are allowed to perform actions if they have the role with the same identifier. In this sense, roles are not
 * being truly used as such, since they each map to a single action identifier.
 *
 * This temporary implementation is expected to be replaced soon after launch by a more sophisticated one, able to
 * manage permissions across multiple contracts and to natively handle timelocks.
 */
contract Authorizer is IAuthorizer {
    using EnumerableSet for EnumerableSet.AddressSet;

    address public constant ANYWHERE = address(-1);

    bytes32 public constant GRANT_PERMISSION = keccak256("GRANT_PERMISSION");
    bytes32 public constant REVOKE_PERMISSION = keccak256("REVOKE_PERMISSION");

    mapping(bytes32 => bool) public isAllowed;

    modifier authenticate(bytes32 action, address where) {
        _require(canPerform(action, msg.sender, where), Errors.SENDER_NOT_ALLOWED);
        _;
    }

    /**
     * @dev Emitted when `account` is granted permission to perform `action` in `where`.
     */
    event PermissionGranted(bytes32 indexed action, address indexed account, address where);

    /**
     * @dev Emitted when an `account`'s permission to perform `action` is revoked from `where`.
     */
    event PermissionRevoked(bytes32 indexed action, address indexed account, address where);

    constructor(address admin) {
        _grantPermission(GRANT_PERMISSION, admin, ANYWHERE);
        _grantPermission(REVOKE_PERMISSION, admin, ANYWHERE);
    }

    /**
     * @dev Tells the permission ID for action `action`, account `account` and target `where`
     */
    function permissionId(
        bytes32 action,
        address account,
        address where
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(action, account, where));
    }

    /**
     * @dev Tells whether `account` has permission to perform `action` in `where`
     */
    function canPerform(
        bytes32 action,
        address account,
        address where
    ) public view override returns (bool) {
        return isAllowed[permissionId(action, account, where)] || isAllowed[permissionId(action, account, ANYWHERE)];
    }

    /**
     * @dev Grants multiple permissions to a single account.
     */
    function grantPermissions(
        bytes32[] memory actions,
        address account,
        address[] memory where
    ) external {
        for (uint256 i = 0; i < actions.length; i++) {
            for (uint256 j = 0; j < where.length; j++) {
                grantPermission(actions[i], account, where[j]);
            }
        }
    }

    /**
     * @dev Revokes multiple permissions from a single account
     */
    function revokePermissions(
        bytes32[] memory actions,
        address account,
        address[] memory where
    ) external {
        for (uint256 i = 0; i < actions.length; i++) {
            for (uint256 j = 0; j < where.length; j++) {
                revokePermission(actions[i], account, where[j]);
            }
        }
    }

    /**
     * @dev Renounces from multiple permissions
     */
    function renouncePermissions(bytes32[] memory actions, address[] memory where) external {
        for (uint256 i = 0; i < actions.length; i++) {
            for (uint256 j = 0; j < where.length; j++) {
                _revokePermission(actions[i], msg.sender, where[j]);
            }
        }
    }

    /**
     * @dev Grants permission to perform `action` to `account` in `where`.
     */
    function grantPermission(
        bytes32 action,
        address account,
        address where
    ) public authenticate(GRANT_PERMISSION, where) {
        _grantPermission(action, account, where);
    }

    /**
     * @dev Revokes permission to perform `action` from `account` in `where`.
     */
    function revokePermission(
        bytes32 action,
        address account,
        address where
    ) public authenticate(REVOKE_PERMISSION, where) {
        _revokePermission(action, account, where);
    }

    function _grantPermission(
        bytes32 action,
        address account,
        address where
    ) private {
        bytes32 permission = permissionId(action, account, where);
        if (!isAllowed[permission]) {
            isAllowed[permission] = true;
            emit PermissionGranted(action, account, where);
        }
    }

    function _revokePermission(
        bytes32 action,
        address account,
        address where
    ) private {
        bytes32 permission = permissionId(action, account, where);
        if (isAllowed[permission]) {
            isAllowed[permission] = false;
            emit PermissionRevoked(action, account, where);
        }
    }
}
