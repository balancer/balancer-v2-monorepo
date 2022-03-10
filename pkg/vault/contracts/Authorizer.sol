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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/IAuthentication.sol";

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
    using Address for address;

    uint256 public constant MAX_DELAY = 2 * (365 days);
    address public constant EVERYWHERE = address(-1);

    bytes32 public constant GRANT_PERMISSION = keccak256("GRANT_PERMISSION");
    bytes32 public constant REVOKE_PERMISSION = keccak256("REVOKE_PERMISSION");
    bytes32 public constant EXECUTE_PERMISSION = keccak256("EXECUTE_PERMISSION");
    bytes32 public constant SET_DELAY_PERMISSION = keccak256("SET_DELAY_PERMISSION");

    struct ScheduledAction {
        address where;
        bytes data;
        bool executed;
        bool cancelled;
        bool protected;
        uint256 executableAt;
    }

    ScheduledAction[] public scheduledActions;
    mapping(bytes32 => bool) public permissionGranted;
    mapping(bytes32 => uint256) public delays;

    /**
     * @dev Emitted when a new action with ID `id` is scheduled
     */
    event ActionScheduled(bytes32 indexed action, uint256 indexed id);

    /**
     * @dev Emitted when an action with ID `id` is executed
     */
    event ActionExecuted(uint256 indexed id);

    /**
     * @dev Emitted when an action with ID `id` is cancelled
     */
    event ActionCancelled(uint256 indexed id);

    /**
     * @dev Emitted when a new `delay` is set in order to perform `action`
     */
    event ActionDelaySet(bytes32 indexed action, uint256 delay);

    /**
     * @dev Emitted when `account` is granted permission to perform `action` in `where`.
     */
    event PermissionGranted(bytes32 indexed action, address indexed account, address indexed where);

    /**
     * @dev Emitted when an `account`'s permission to perform `action` is revoked from `where`.
     */
    event PermissionRevoked(bytes32 indexed action, address indexed account, address indexed where);

    constructor(address admin) {
        _grantPermission(GRANT_PERMISSION, admin, EVERYWHERE);
        _grantPermission(REVOKE_PERMISSION, admin, EVERYWHERE);
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
     * @dev Tells whether `account` has explicit permission to perform `action` in `where`
     */
    function hasPermission(
        bytes32 action,
        address account,
        address where
    ) public view returns (bool) {
        return
            permissionGranted[permissionId(action, account, where)] ||
            permissionGranted[permissionId(action, account, EVERYWHERE)];
    }

    /**
     * @dev Tells whether `account` can perform `action` in `where`
     */
    function canPerform(
        bytes32 action,
        address account,
        address where
    ) public view override returns (bool) {
        return (delays[action] > 0) ? account == address(this) : hasPermission(action, account, where);
    }

    /**
     * @dev Sets a new delay for `action`
     */
    function setDelay(bytes32 action, uint256 delay) external {
        _require(msg.sender == address(this), Errors.SENDER_NOT_ALLOWED);
        delays[action] = delay;
        emit ActionDelaySet(action, delay);
    }

    /**
     * @dev Schedules a delay change of `newDelay` for `action`
     */
    function scheduleDelayChange(
        bytes32 action,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256 id) {
        require(newDelay <= MAX_DELAY, "DELAY_TOO_LARGE");
        bytes32 setDelayAction = keccak256(abi.encodePacked(SET_DELAY_PERMISSION, action));
        _authenticate(setDelayAction, address(this));

        uint256 actionDelay = delays[action];
        bytes memory data = abi.encodeWithSelector(this.setDelay.selector, action, newDelay);
        return _schedule(setDelayAction, address(this), data, actionDelay, executors);
    }

    /**
     * @dev Schedules a new action
     */
    function schedule(
        address where,
        bytes memory data,
        address[] memory executors
    ) external returns (uint256 id) {
        require(where != address(this), "CANNOT_SCHEDULE_AUTHORIZER_ACTIONS");
        bytes32 action = IAuthentication(where).getActionId(_decodeSelector(data));
        _require(hasPermission(action, msg.sender, where), Errors.SENDER_NOT_ALLOWED);

        uint256 delay = delays[action];
        require(delay > 0, "CANNOT_SCHEDULE_ACTION");
        return _schedule(action, where, data, delay, executors);
    }

    /**
     * @dev Executes action `id`
     */
    function execute(uint256 id) external returns (bytes memory result) {
        require(id < scheduledActions.length, "ACTION_DOES_NOT_EXIST");
        ScheduledAction storage scheduledAction = scheduledActions[id];
        require(!scheduledAction.executed, "ACTION_ALREADY_EXECUTED");
        require(!scheduledAction.cancelled, "ACTION_ALREADY_CANCELLED");

        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp >= scheduledAction.executableAt, "ACTION_NOT_EXECUTABLE");
        if (scheduledAction.protected) {
            _authenticate(_executeActionId(id), address(this));
        }

        scheduledAction.executed = true;
        result = scheduledAction.where.functionCall(scheduledAction.data);
        emit ActionExecuted(id);
    }

    /**
     * @dev Cancels action `id`
     */
    function cancel(uint256 id) external {
        require(id < scheduledActions.length, "ACTION_DOES_NOT_EXIST");
        ScheduledAction storage scheduledAction = scheduledActions[id];

        require(!scheduledAction.executed, "ACTION_ALREADY_EXECUTED");
        require(!scheduledAction.cancelled, "ACTION_ALREADY_CANCELLED");

        bytes32 action = IAuthentication(scheduledAction.where).getActionId(_decodeSelector(scheduledAction.data));
        _require(hasPermission(action, msg.sender, scheduledAction.where), Errors.SENDER_NOT_ALLOWED);

        scheduledAction.cancelled = true;
        emit ActionCancelled(id);
    }

    /**
     * @dev Grants multiple permissions to a single account.
     */
    function grantPermissions(
        bytes32[] memory actions,
        address account,
        address[] memory where
    ) external {
        InputHelpers.ensureInputLengthMatch(actions.length, where.length);
        for (uint256 i = 0; i < actions.length; i++) {
            _authenticate(GRANT_PERMISSION, where[i]);
            _grantPermission(actions[i], account, where[i]);
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
        InputHelpers.ensureInputLengthMatch(actions.length, where.length);
        for (uint256 i = 0; i < actions.length; i++) {
            _authenticate(REVOKE_PERMISSION, where[i]);
            _revokePermission(actions[i], account, where[i]);
        }
    }

    /**
     * @dev Renounces from multiple permissions
     */
    function renouncePermissions(bytes32[] memory actions, address[] memory where) external {
        InputHelpers.ensureInputLengthMatch(actions.length, where.length);
        for (uint256 i = 0; i < actions.length; i++) {
            _revokePermission(actions[i], msg.sender, where[i]);
        }
    }

    function _grantPermission(
        bytes32 action,
        address account,
        address where
    ) private {
        bytes32 permission = permissionId(action, account, where);
        if (!permissionGranted[permission]) {
            permissionGranted[permission] = true;
            emit PermissionGranted(action, account, where);
        }
    }

    function _revokePermission(
        bytes32 action,
        address account,
        address where
    ) private {
        bytes32 permission = permissionId(action, account, where);
        if (permissionGranted[permission]) {
            permissionGranted[permission] = false;
            emit PermissionRevoked(action, account, where);
        }
    }

    function _schedule(
        bytes32 action,
        address where,
        bytes memory data,
        uint256 delay,
        address[] memory executors
    ) private returns (uint256 id) {
        id = scheduledActions.length;
        emit ActionScheduled(action, id);

        // solhint-disable-next-line not-rely-on-time
        uint256 executableAt = block.timestamp + delay;
        bool protected = executors.length > 0;
        scheduledActions.push(ScheduledAction(where, data, false, false, protected, executableAt));

        bytes32 executeActionId = _executeActionId(id);
        for (uint256 i = 0; i < executors.length; i++) {
            _grantPermission(executeActionId, executors[i], address(this));
        }
    }

    function _authenticate(bytes32 action, address where) internal view {
        _require(hasPermission(action, msg.sender, where), Errors.SENDER_NOT_ALLOWED);
    }

    function _executeActionId(uint256 id) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(EXECUTE_PERMISSION, id));
    }

    function _decodeSelector(bytes memory data) internal pure returns (bytes4) {
        // The bytes4 type is left-aligned and padded with zeros: we make use of that property to build the selector
        if (data.length < 4) return bytes4(0);
        return bytes4(data[0]) | (bytes4(data[1]) >> 8) | (bytes4(data[2]) >> 16) | (bytes4(data[3]) >> 24);
    }
}
