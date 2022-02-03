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

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    address public constant GLOBAL_ROLE_ADMIN = address(0);

    struct RoleData {
        EnumerableSet.AddressSet globalMembers;
        mapping(address => EnumerableSet.AddressSet) membersByContract;
        bytes32 adminRole;
    }

    mapping(bytes32 => RoleData) private _roles;

    /**
     * @dev Emitted when `newAdminRole` is set as ``role``'s admin role, replacing `previousAdminRole`
     *
     * `DEFAULT_ADMIN_ROLE` is the starting admin for all roles, despite
     * {RoleAdminChanged} not being emitted signaling this.
     *
     * _Available since v3.1._
     */
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);

    /**
     * @dev Emitted when `account` is granted `role` in an specific contract `where`.
     *
     * `sender` is the account that originated the contract call
     */
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender, address where);

    /**
     * @dev Emitted when `account` is granted `role` across all contracts.
     *
     * `sender` is the account that originated the contract call
     */
    event RoleGrantedGlobally(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is revoked `role` in an specific contract `where`.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokeRole`, it is the admin role bearer
     *   - if using `renounceRole`, it is the role bearer (i.e. `account`)
     */
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender, address where);

    /**
     * @dev Emitted when `account` is revoked `role` across all contracts.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokeRole`, it is the admin role bearer
     *   - if using `renounceRole`, it is the role bearer (i.e. `account`)
     */
    event RoleRevokedGlobally(bytes32 indexed role, address indexed account, address indexed sender);

    constructor(address admin) {
        _grantRoleGlobally(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @dev Returns `true` if `account` has permission for `actionId` either globally or in specific `where`
     */
    function canPerform(
        bytes32 actionId,
        address account,
        address where
    ) public view override returns (bool) {
        return
            _roles[actionId].globalMembers.contains(account) ||
            _roles[actionId].membersByContract[where].contains(account);
    }

    /**
     * @dev Returns `true` if `account` has been granted admin role for `role`
     */
    function isAdmin(bytes32 role, address account) public view returns (bool) {
        return canPerform(_roles[role].adminRole, account, GLOBAL_ROLE_ADMIN);
    }

    /**
     * @dev Returns the number of accounts that have `role` as global permission. Can be used
     * together with {getRoleGlobalMember} to enumerate all bearers of a role.
     */
    function getRoleGlobalMemberCount(bytes32 role) public view returns (uint256) {
        return _roles[role].globalMembers.length();
    }

    /**
     * @dev Returns one of the accounts that have `role` across contracts. `index` must be a
     * value between 0 and {getRoleGlobalMemberCount}, non-inclusive.
     *
     * Role bearers are not sorted in any particular way, and their ordering may
     * change at any point.
     *
     * WARNING: When using {getRoleGlobalMember} and {getRoleGlobalMemberCount}, make sure
     * you perform all queries on the same block. See the following
     * https://forum.openzeppelin.com/t/iterating-over-elements-on-enumerableset-in-openzeppelin-contracts/2296
     * for more information.
     */
    function getRoleGlobalMember(bytes32 role, uint256 index) public view returns (address) {
        return _roles[role].globalMembers.at(index);
    }

    /**
     * @dev Returns the number of accounts that have `role` as global permission. Can be used
     * together with {getRoleGlobalMember} to enumerate all bearers of a role.
     */
    function getRoleMemberCountByContract(bytes32 role, address where) public view returns (uint256) {
        return _roles[role].membersByContract[where].length();
    }

    /**
     * @dev Returns one of the accounts that have `role` in contract `where`. `index` must be a
     * value between 0 and {getRoleMemberCountByContract}, non-inclusive.
     *
     * Role bearers are not sorted in any particular way, and their ordering may
     * change at any point.
     *
     * WARNING: When using {getRoleMemberByContract} and {getRoleMemberCountByContract}, make sure
     * you perform all queries on the same block. See the following
     * https://forum.openzeppelin.com/t/iterating-over-elements-on-enumerableset-in-openzeppelin-contracts/2296
     * for more information.
     */
    function getRoleMemberByContract(
        bytes32 role,
        uint256 index,
        address where
    ) public view returns (address) {
        return _roles[role].membersByContract[where].at(index);
    }

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) public view returns (bytes32) {
        return _roles[role].adminRole;
    }

    /**
     * @dev Grants multiple roles to a single account for a set of contracts.
     */
    function grantRoles(
        bytes32[] memory roles,
        address account,
        address[] calldata where
    ) external {
        _require(where.length > 0, Errors.INPUT_LENGTH_MISMATCH);
        for (uint256 i = 0; i < roles.length; i++) {
            _require(isAdmin(roles[i], msg.sender), Errors.GRANT_SENDER_NOT_ADMIN);
            for (uint256 j = 0; j < where.length; j++) {
                _grantRole(roles[i], account, where[j]);
            }
        }
    }

    /**
     * @dev Grants multiple roles to a single account for all contracts.
     */
    function grantRolesGlobally(bytes32[] memory roles, address account) external {
        for (uint256 i = 0; i < roles.length; i++) {
            _require(isAdmin(roles[i], msg.sender), Errors.GRANT_SENDER_NOT_ADMIN);
            _grantRoleGlobally(roles[i], account);
        }
    }

    /**
     * @dev Revokes multiple roles from a single account for a set of contracts.
     */
    function revokeRoles(
        bytes32[] memory roles,
        address account,
        address[] calldata where
    ) external {
        _require(where.length > 0, Errors.INPUT_LENGTH_MISMATCH);
        for (uint256 i = 0; i < roles.length; i++) {
            _require(isAdmin(roles[i], msg.sender), Errors.REVOKE_SENDER_NOT_ADMIN);
            _revokeRole(roles[i], account, where);
        }
    }

    /**
     * @dev Revokes multiple roles from a single account for all contracts.
     */
    function revokeRolesGlobally(bytes32[] memory roles, address account) external {
        for (uint256 i = 0; i < roles.length; i++) {
            _require(isAdmin(roles[i], msg.sender), Errors.REVOKE_SENDER_NOT_ADMIN);
            _revokeRoleGlobally(roles[i], account);
        }
    }

    /**
     * @dev Renounces from multiple `roles` for the sender for a set of contracts.
     */
    function renounceRoles(bytes32[] memory roles, address[] calldata where) public virtual {
        _require(where.length > 0, Errors.INPUT_LENGTH_MISMATCH);
        for (uint256 i = 0; i < roles.length; i++) {
            _revokeRole(roles[i], msg.sender, where);
        }
    }

    /**
     * @dev Renounces from multiple `roles` for the sender for all contracts.
     */
    function renounceRolesGlobally(bytes32[] memory roles) public virtual {
        for (uint256 i = 0; i < roles.length; i++) {
            _revokeRoleGlobally(roles[i], msg.sender);
        }
    }

    /**
     * @dev Sets `adminRole` as ``role``'s admin role.
     *
     * Emits a {RoleAdminChanged} event.
     */
    function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal virtual {
        emit RoleAdminChanged(role, _roles[role].adminRole, adminRole);
        _roles[role].adminRole = adminRole;
    }

    function _grantRole(
        bytes32 role,
        address account,
        address where
    ) private {
        require(where != address(0), "Where can't be GLOBAL_ROLE_ADMIN");
        if (_roles[role].membersByContract[where].add(account)) {
            emit RoleGranted(role, account, msg.sender, where);
        }
    }

    function _grantRoleGlobally(bytes32 role, address account) private {
        if (_roles[role].globalMembers.add(account)) {
            emit RoleGrantedGlobally(role, account, msg.sender);
        }
    }

    function _revokeRole(
        bytes32 role,
        address account,
        address[] calldata where
    ) private {
        for (uint256 i = 0; i < where.length; i++) {
            if (_roles[role].membersByContract[where[i]].remove(account)) {
                emit RoleRevoked(role, account, msg.sender, where[i]);
            }
        }
    }

    function _revokeRoleGlobally(bytes32 role, address account) private {
        if (_roles[role].globalMembers.remove(account)) {
            emit RoleRevokedGlobally(role, account, msg.sender);
        }
    }
}
