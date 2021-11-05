// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "../helpers/BalancerErrors.sol";

import "./EnumerableSet.sol";

/**
 * @dev Contract module that allows children to implement role-based access
 * control mechanisms.
 *
 * Roles are referred to by their `bytes32` identifier. These should be exposed
 * in the external API and be unique. The best way to achieve this is by
 * using `public constant` hash digests:
 *
 * ```
 * bytes32 public constant MY_ROLE = keccak256("MY_ROLE");
 * ```
 *
 * Roles can be used to represent a set of permissions. To restrict access to a
 * function call, use {hasRole}:
 *
 * ```
 * function foo() public {
 *     require(hasRole(MY_ROLE, msg.sender));
 *     ...
 * }
 * ```
 *
 * Roles can be granted and revoked dynamically via the {grantRole} and
 * {revokeRole} functions. Each role has an associated admin role, and only
 * accounts that have a role's admin role can call {grantRole} and {revokeRole}.
 *
 * By default, the admin role for all roles is `DEFAULT_ADMIN_ROLE`, which means
 * that only accounts with this role will be able to grant or revoke other
 * roles. More complex role relationships can be created by using
 * {_setRoleAdmin}.
 *
 * WARNING: The `DEFAULT_ADMIN_ROLE` is also its own admin: it has permission to
 * grant and revoke this role. Extra precautions should be taken to secure
 * accounts that have been granted it.
 */
abstract contract AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;

    struct RoleData {
        EnumerableSet.AddressSet globalMembers;
        mapping(address => EnumerableSet.AddressSet) membersByContract;
        bytes32 adminRole;
    }

    mapping(bytes32 => RoleData) private _roles;

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    address public constant GLOBAL_ROLE_ADMIN = address(0);
    
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
     * `sender` is the account that originated the contract call, an admin role
     * bearer except when using {_setupRole}.
     */
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender, address where);

    /**
     * @dev Emitted when `account` is granted `role` across all contracts.
     *
     * `sender` is the account that originated the contract call, an admin role
     * bearer except when using {_setupRole}.
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

    /**
     * @dev Returns `true` if `account` has been granted `role` either globally
     * or in specific `where`
     */
    function hasRole(bytes32 role, address account, address where) public view virtual returns (bool) {
        return _roles[role].globalMembers.contains(account) || 
            _roles[role].membersByContract[where].contains(account);
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
     * https://forum.openzeppelin.com/t/iterating-over-elements-on-enumerableset-in-openzeppelin-contracts/2296[forum post]
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
     * https://forum.openzeppelin.com/t/iterating-over-elements-on-enumerableset-in-openzeppelin-contracts/2296[forum post]
     * for more information.
     */
    function getRoleMemberByContract(bytes32 role, uint256 index, address where) public view returns (address) {
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
     * @dev Grants `role` to `account` in specific contracts.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     * - list of ``where``'s can't be empty
     */
    function grantRole(bytes32 role, address account, address[] calldata where) public virtual {
        _require(where.length > 0, Errors.INPUT_LENGTH_MISMATCH);
        _require(hasRole(_roles[role].adminRole, msg.sender, GLOBAL_ROLE_ADMIN), Errors.GRANT_SENDER_NOT_ADMIN);
        for (uint256 i = 0; i < where.length; i++) {
            _grantRole(role, account, where[i]);
        }
        
    }

    /**
     * @dev Grants `role` to `account` in across all contracts.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function grantRoleGlobally(bytes32 role, address account) public virtual {
        _require(hasRole(_roles[role].adminRole, msg.sender, GLOBAL_ROLE_ADMIN), Errors.GRANT_SENDER_NOT_ADMIN);
        _grantRoleGlobally(role, account);
        
    }

    /**
     * @dev Revokes `role` from `account` accross all.
     *
     * If `account` had already been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     * - list of ``where``'s can't be empty
     */
    function revokeRole(bytes32 role, address account, address[] calldata where) public virtual {
        _require(hasRole(_roles[role].adminRole, msg.sender, GLOBAL_ROLE_ADMIN), Errors.REVOKE_SENDER_NOT_ADMIN);
        _require(where.length > 0, Errors.INPUT_LENGTH_MISMATCH);
        _revokeRole(role, account, where);
    }

    /**
     * @dev Revokes `role` from `account` across all contracts.
     *
     * If `account` had already been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function revokeRoleGlobally(bytes32 role, address account) public virtual {
        _require(hasRole(_roles[role].adminRole, msg.sender, GLOBAL_ROLE_ADMIN), Errors.REVOKE_SENDER_NOT_ADMIN);
        _revokeRoleGlobally(role, account);
    }

    /**
     * @dev Revokes `role` from the calling account, for specific contracts.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been granted `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `account`.
     * - list of ``where``'s can't be empty
     */
    function renounceRole(bytes32 role, address account,address[] calldata where) public virtual {
        _require(account == msg.sender, Errors.RENOUNCE_SENDER_NOT_ALLOWED);
        _revokeRole(role, account, where);
    }

    /**
     * @dev Revokes `role` from the calling account, for all contracts.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been granted `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `account`.
     */
    function renounceRoleGlobally(bytes32 role, address account) public virtual {
        _require(account == msg.sender, Errors.RENOUNCE_SENDER_NOT_ALLOWED);
        _revokeRoleGlobally(role, account);
    }

    

    /**
     * @dev Grants `role` to `account`, globally for all contracts
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event. Note that unlike {grantRole}, this function doesn't perform any
     * checks on the calling account.
     *
     * [WARNING]
     * ====
     * This function should only be called from the constructor when setting
     * up the initial roles for the system.
     *
     * Using this function in any other way is effectively circumventing the admin
     * system imposed by {AccessControl}.
     * ====
     */
    function _setupRole(bytes32 role, address account) internal virtual {
        _grantRoleGlobally(role, account);
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

    function _grantRole(bytes32 role, address account, address where) private {
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

    function _revokeRole(bytes32 role, address account, address[] calldata where) private {
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
