// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "../helpers/BalancerErrors.sol";

import "./EnumerableSet.sol";

/**
 * @dev Contract module that allows children to implement permission-based access
 * control mechanisms.
 *
 * Permissions are referred to by their `bytes32` identifier. These should be exposed
 * in the external API and be unique. The best way to achieve this is by
 * using `public constant` hash digests:
 *
 * ```
 * bytes32 public constant MY_PERMISSION = keccak256("MY_PERMISSION");
 * ```
 *
 * Permissions can be used to represent a set of permissions. To restrict access to a
 * function call, use {hasPermission}:
 *
 * ```
 * function foo() public {
 *     require(hasPermission(MY_PERMISSION, msg.sender));
 *     ...
 * }
 * ```
 *
 * Permissions can be granted and revoked dynamically via the {grantPermission} and
 * {revokePermission} functions. Each permission has an associated admin permission, and only
 * accounts that have a permission's admin permission can call {grantPermission} and {revokePermission}.
 *
 * By default, the admin permission for all permissions is `DEFAULT_ADMIN_PERMISSION`, which means
 * that only accounts with this permission will be able to grant or revoke other
 * permissions. More complex permission relationships can be created by using
 * {_setPermissionAdmin}.
 *
 * WARNING: The `DEFAULT_ADMIN_PERMISSION` is also its own admin: it has permission to
 * grant and revoke this permission. Extra precautions should be taken to secure
 * accounts that have been granted it.
 */
abstract contract AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;

    struct PermissionData {
        EnumerableSet.AddressSet globalMembers;
        mapping(address => EnumerableSet.AddressSet) membersByContract;
        EnumerableSet.AddressSet admins;
    }

    mapping(bytes32 => PermissionData) private _permissions;

    bytes32 public constant GLOBAL_PERMISSION_ADMIN = bytes32(0);

    /**
     * @dev Emitted when `account` is granted admin rights over `permission`.
     *
     * `sender` is the account that originated the contract call, an admin rights
     * bearer except when using {_setupPermission}.
     */
    event AdminRightsGranted(bytes32 indexed permission, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is revoked admin rights over `permission`.
     *
     * `sender` is the account holding admin rights that originated the contract call.
     */
    event AdminRightsRevoked(bytes32 indexed permission, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is granted `permission` in an specific contract `where`.
     *
     * `sender` is the account that originated the contract call, an admin rights
     * bearer except when using {_setupPermission}.
     */
    event PermissionGranted(bytes32 indexed permission, address indexed account, address indexed sender, address where);

    /**
     * @dev Emitted when `account` is granted `permission` across all contracts.
     *
     * `sender` is the account that originated the contract call, an admin rights
     * bearer except when using {_setupPermission}.
     */
    event PermissionGrantedGlobally(bytes32 indexed permission, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is revoked `permission` in an specific contract `where`.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokePermission`, it is the admin rights bearer
     *   - if using `renouncePermission`, it is the permission bearer (i.e. `account`)
     */
    event PermissionRevoked(bytes32 indexed permission, address indexed account, address indexed sender, address where);

    /**
     * @dev Emitted when `account` is revoked `permission` across all contracts.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokePermission`, it is the admin rights bearer
     *   - if using `renouncePermission`, it is the permission bearer (i.e. `account`)
     */
    event PermissionRevokedGlobally(bytes32 indexed permission, address indexed account, address indexed sender);

    /**
     * @dev Returns `true` if `account` has admin role over `permission`
     */
    function isAdminFor(bytes32 permission, address account) public view virtual returns (bool) {
        return
            _permissions[permission].admins.contains(account) ||
            _permissions[GLOBAL_PERMISSION_ADMIN].admins.contains(account);
    }

    /**
     * @dev Returns the number of accounts that are admins for `permission`. Can be used
     * together with {getPermissionAdmin} to enumerate all admins of a permission.
     */
    function getPermissionAdminCount(bytes32 permission) public view returns (uint256) {
        return _permissions[permission].admins.length();
    }

    // solhint-disable max-line-length
    /**
     * @dev Returns one of the accounts that are an admin for `permission`. `index` must be a
     * value between 0 and {getPermissionAdminCount}, non-inclusive.
     *
     * Permission admins are not sorted in any particular way, and their ordering may
     * change at any point.
     *
     * WARNING: When using {getPermissionAdmin} and {getPermissionAdminCount}, make sure
     * you perform all queries on the same block. See the following
     * https://forum.openzeppelin.com/t/iterating-over-elements-on-enumerableset-in-openzeppelin-contracts/2296[forum post]
     * for more information.
     */
    // solhint-enable max-line-length
    function getPermissionAdmin(bytes32 permission, uint256 index) public view returns (address) {
        return _permissions[permission].admins.at(index);
    }

    /**
     * @dev Returns `true` if `account` has been granted `permission` either globally
     * or in specific `where`
     */
    function hasPermission(
        bytes32 permission,
        address account,
        address where
    ) public view virtual returns (bool) {
        return
            _permissions[permission].globalMembers.contains(account) ||
            _permissions[permission].membersByContract[where].contains(account);
    }

    /**
     * @dev Returns the number of accounts that have `permission` as global permission. Can be used
     * together with {getPermissionGlobalMember} to enumerate all bearers of a permission.
     */
    function getPermissionGlobalMemberCount(bytes32 permission) public view returns (uint256) {
        return _permissions[permission].globalMembers.length();
    }

    // solhint-disable max-line-length
    /**
     * @dev Returns one of the accounts that have `permission` across contracts. `index` must be a
     * value between 0 and {getPermissionGlobalMemberCount}, non-inclusive.
     *
     * Permission bearers are not sorted in any particular way, and their ordering may
     * change at any point.
     *
     * WARNING: When using {getPermissionGlobalMember} and {getPermissionGlobalMemberCount}, make sure
     * you perform all queries on the same block. See the following
     * https://forum.openzeppelin.com/t/iterating-over-elements-on-enumerableset-in-openzeppelin-contracts/2296[forum post]
     * for more information.
     */
    // solhint-enable max-line-length
    function getPermissionGlobalMember(bytes32 permission, uint256 index) public view returns (address) {
        return _permissions[permission].globalMembers.at(index);
    }

    /**
     * @dev Returns the number of accounts that have `permission` as global permission. Can be used
     * together with {getPermissionGlobalMember} to enumerate all bearers of a permission.
     */
    function getPermissionMemberCountByContract(bytes32 permission, address where) public view returns (uint256) {
        return _permissions[permission].membersByContract[where].length();
    }

    // solhint-disable max-line-length
    /**
     * @dev Returns one of the accounts that have `permission` in contract `where`. `index` must be a
     * value between 0 and {getPermissionMemberCountByContract}, non-inclusive.
     *
     * Permission bearers are not sorted in any particular way, and their ordering may
     * change at any point.
     *
     * WARNING: When using {getPermissionMemberByContract} and {getPermissionMemberCountByContract}, make sure
     * you perform all queries on the same block. See the following
     * https://forum.openzeppelin.com/t/iterating-over-elements-on-enumerableset-in-openzeppelin-contracts/2296[forum post]
     * for more information.
     */
    // solhint-enable max-line-length
    function getPermissionMemberByContract(
        bytes32 permission,
        uint256 index,
        address where
    ) public view returns (address) {
        return _permissions[permission].membersByContract[where].at(index);
    }

    /**
     * @dev Grants admin rights over `permission` to `account`.
     *
     * If `account` had not been already granted admin rights over `permission`, emits an {AdminRightsGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have admin rights over ``permission``.
     */
    function grantAdminRights(bytes32 permission, address account) public virtual {
        _require(isAdminFor(permission, msg.sender), Errors.GRANT_SENDER_NOT_ADMIN);
        _grantAdminRights(permission, account);
    }

    /**
     * @dev Revokes admin rights over `permission` from `account`.
     *
     * If `account` had already been granted admin rights over `permission`, emits an {AdminRightsRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have admin rights over ``permission``.
     */
    function revokeAdminRights(bytes32 permission, address account) public virtual {
        _require(isAdminFor(permission, msg.sender), Errors.REVOKE_SENDER_NOT_ADMIN);
        _revokeAdminRights(permission, account);
    }

    /**
     * @dev Revokes admin rights for `permission` from the calling account.
     *
     * Permissions are often managed via {grantAdminRights} and {revokeAdminRights}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been granted admin rights over `permission`, emits an {AdminRightsRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `account`.
     */
    function renounceAdminRights(bytes32 permission, address account) public virtual {
        _require(account == msg.sender, Errors.RENOUNCE_SENDER_NOT_ALLOWED);
        _revokeAdminRights(permission, account);
    }

    /**
     * @dev Grants `permission` to `account` in specific contracts.
     *
     * If `account` had not been already granted `permission`, emits a {PermissionGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``permission``'s admin permission.
     * - list of ``where``'s can't be empty
     */
    function grantPermission(
        bytes32 permission,
        address account,
        address[] calldata where
    ) public virtual {
        _require(where.length > 0, Errors.INPUT_LENGTH_MISMATCH);
        _require(isAdminFor(permission, msg.sender), Errors.GRANT_SENDER_NOT_ADMIN);
        for (uint256 i = 0; i < where.length; i++) {
            _grantPermission(permission, account, where[i]);
        }
    }

    /**
     * @dev Grants `permission` to `account` in across all contracts.
     *
     * If `account` had not been already granted `permission`, emits a {PermissionGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``permission``'s admin permission.
     */
    function grantPermissionGlobally(bytes32 permission, address account) public virtual {
        _require(isAdminFor(permission, msg.sender), Errors.GRANT_SENDER_NOT_ADMIN);
        _grantPermissionGlobally(permission, account);
    }

    /**
     * @dev Revokes `permission` from `account` accross all.
     *
     * If `account` had already been granted `permission`, emits a {PermissionRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``permission``'s admin permission.
     * - list of ``where``'s can't be empty
     */
    function revokePermission(
        bytes32 permission,
        address account,
        address[] calldata where
    ) public virtual {
        _require(isAdminFor(permission, msg.sender), Errors.REVOKE_SENDER_NOT_ADMIN);
        _require(where.length > 0, Errors.INPUT_LENGTH_MISMATCH);
        _revokePermission(permission, account, where);
    }

    /**
     * @dev Revokes `permission` from `account` across all contracts.
     *
     * If `account` had already been granted `permission`, emits a {PermissionRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``permission``'s admin permission.
     */
    function revokePermissionGlobally(bytes32 permission, address account) public virtual {
        _require(isAdminFor(permission, msg.sender), Errors.REVOKE_SENDER_NOT_ADMIN);
        _revokePermissionGlobally(permission, account);
    }

    /**
     * @dev Revokes `permission` from the calling account, for specific contracts.
     *
     * Permissions are often managed via {grantPermission} and {revokePermission}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been granted `permission`, emits a {PermissionRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `account`.
     * - list of ``where``'s can't be empty
     */
    function renouncePermission(
        bytes32 permission,
        address account,
        address[] calldata where
    ) public virtual {
        _require(account == msg.sender, Errors.RENOUNCE_SENDER_NOT_ALLOWED);
        _revokePermission(permission, account, where);
    }

    /**
     * @dev Revokes `permission` from the calling account, for all contracts.
     *
     * Permissions are often managed via {grantPermission} and {revokePermission}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been granted `permission`, emits a {PermissionRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `account`.
     */
    function renouncePermissionGlobally(bytes32 permission, address account) public virtual {
        _require(account == msg.sender, Errors.RENOUNCE_SENDER_NOT_ALLOWED);
        _revokePermissionGlobally(permission, account);
    }

    /**
     * @dev Grants `permission` to `account`, globally for all contracts
     *
     * If `account` had not been already granted `permission`, emits a {PermissionGranted}
     * event. Note that unlike {grantPermission}, this function doesn't perform any
     * checks on the calling account.
     *
     * [WARNING]
     * ====
     * This function should only be called from the constructor when setting
     * up the initial permissions for the system.
     *
     * Using this function in any other way is effectively circumventing the admin
     * system imposed by {AccessControl}.
     * ====
     */
    function _setupPermission(bytes32 permission, address account) internal virtual {
        _grantPermissionGlobally(permission, account);
    }

    /**
     * @dev Grants admin rights over `permission` to `account`.
     *
     * If `account` had not been already granted admin rights over `permission`,
     * emits an {AdminRightsGranted} event. Note that unlike {grantPermission},
     * this function doesn't perform any checks on the calling account.
     *
     * [WARNING]
     * ====
     * This function should only be called from the constructor when setting
     * up the initial admins for the system.
     *
     * Using this function in any other way is effectively circumventing the admin
     * system imposed by {AccessControl}.
     * ====
     */
    function _setupAdmin(bytes32 permission, address account) internal virtual {
        _grantAdminRights(permission, account);
    }

    function _grantAdminRights(bytes32 permission, address account) private {
        if (_permissions[permission].admins.add(account)) {
            emit AdminRightsGranted(permission, account, msg.sender);
        }
    }

    function _revokeAdminRights(bytes32 permission, address account) private {
        if (_permissions[permission].admins.remove(account)) {
            emit AdminRightsRevoked(permission, account, msg.sender);
        }
    }

    function _grantPermission(
        bytes32 permission,
        address account,
        address where
    ) private {
        if (_permissions[permission].membersByContract[where].add(account)) {
            emit PermissionGranted(permission, account, msg.sender, where);
        }
    }

    function _grantPermissionGlobally(bytes32 permission, address account) private {
        if (_permissions[permission].globalMembers.add(account)) {
            emit PermissionGrantedGlobally(permission, account, msg.sender);
        }
    }

    function _revokePermission(
        bytes32 permission,
        address account,
        address[] calldata where
    ) private {
        for (uint256 i = 0; i < where.length; i++) {
            if (_permissions[permission].membersByContract[where[i]].remove(account)) {
                emit PermissionRevoked(permission, account, msg.sender, where[i]);
            }
        }
    }

    function _revokePermissionGlobally(bytes32 permission, address account) private {
        if (_permissions[permission].globalMembers.remove(account)) {
            emit PermissionRevokedGlobally(permission, account, msg.sender);
        }
    }
}
