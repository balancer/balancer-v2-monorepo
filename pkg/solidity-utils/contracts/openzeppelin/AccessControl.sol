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
        bytes32 adminPermission;
    }

    mapping(bytes32 => PermissionData) private _permissions;

    bytes32 public constant DEFAULT_ADMIN_PERMISSION = 0x00;
    address public constant GLOBAL_PERMISSION_ADMIN = address(0);

    /**
     * @dev Emitted when `newAdminPermission` is set as ``permission``'s admin permission,
     *      replacing `previousAdminPermission`
     *
     * `DEFAULT_ADMIN_PERMISSION` is the starting admin for all Permissions, despite
     * {PermissionAdminChanged} not being emitted signaling this.
     *
     * _Available since v3.1._
     */
    event PermissionAdminChanged(
        bytes32 indexed permission,
        bytes32 indexed previousAdminPermission,
        bytes32 indexed newAdminPermission
    );

    /**
     * @dev Emitted when `account` is granted `permission` in an specific contract `where`.
     *
     * `sender` is the account that originated the contract call, an admin permission
     * bearer except when using {_setupPermission}.
     */
    event PermissionGranted(bytes32 indexed permission, address indexed account, address indexed sender, address where);

    /**
     * @dev Emitted when `account` is granted `permission` across all contracts.
     *
     * `sender` is the account that originated the contract call, an admin permission
     * bearer except when using {_setupPermission}.
     */
    event PermissionGrantedGlobally(bytes32 indexed permission, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is revoked `permission` in an specific contract `where`.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokePermission`, it is the admin permission bearer
     *   - if using `renouncePermission`, it is the permission bearer (i.e. `account`)
     */
    event PermissionRevoked(bytes32 indexed permission, address indexed account, address indexed sender, address where);

    /**
     * @dev Emitted when `account` is revoked `permission` across all contracts.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokePermission`, it is the admin permission bearer
     *   - if using `renouncePermission`, it is the permission bearer (i.e. `account`)
     */
    event PermissionRevokedGlobally(bytes32 indexed permission, address indexed account, address indexed sender);

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
     * @dev Returns the admin permission that controls `permission`. See {grantPermission} and
     * {revokePermission}.
     *
     * To change a permission's admin, use {_setPermissionAdmin}.
     */
    function getPermissionAdmin(bytes32 permission) public view returns (bytes32) {
        return _permissions[permission].adminPermission;
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
        _require(
            hasPermission(_permissions[permission].adminPermission, msg.sender, GLOBAL_PERMISSION_ADMIN),
            Errors.GRANT_SENDER_NOT_ADMIN
        );
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
        _require(
            hasPermission(_permissions[permission].adminPermission, msg.sender, GLOBAL_PERMISSION_ADMIN),
            Errors.GRANT_SENDER_NOT_ADMIN
        );
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
        _require(
            hasPermission(_permissions[permission].adminPermission, msg.sender, GLOBAL_PERMISSION_ADMIN),
            Errors.REVOKE_SENDER_NOT_ADMIN
        );
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
        _require(
            hasPermission(_permissions[permission].adminPermission, msg.sender, GLOBAL_PERMISSION_ADMIN),
            Errors.REVOKE_SENDER_NOT_ADMIN
        );
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
     * @dev Sets `adminPermission` as ``permission``'s admin permission.
     *
     * Emits a {PermissionAdminChanged} event.
     */
    function _setPermissionAdmin(bytes32 permission, bytes32 adminPermission) internal virtual {
        emit PermissionAdminChanged(permission, _permissions[permission].adminPermission, adminPermission);
        _permissions[permission].adminPermission = adminPermission;
    }

    function _grantPermission(
        bytes32 permission,
        address account,
        address where
    ) private {
        require(where != address(0), "Where can't be GLOBAL_PERMISSION_ADMIN");
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
