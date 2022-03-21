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
import "./interfaces/IVault.sol";

/**
 * @dev Basic Authorizer implementation using timelocks.
 *
 * Users are allowed to perform actions if they have the permission to do so.
 *
 * This Authorizer implementation allows defining a delay per action identifier. If a delay is set for an action, users
 * are now allowed to schedule an execution that will be triggered in the future by the Authorizer instead of executing
 * it themselves directly.
 *
 * Glossary:
 * - Action: Op that can be performed to a target contract. These are identified by a unique bytes32 `actionId` defined
 *   by each target contract following `IAuthentication#getActionId`.
 * - Scheduled execution: The Authorizer can define different delays per `actionId` in order to determine that a
 *   specific time window must pass before these can be executed. When a delay is set for an `actionId`, executions
 *   must be scheduled. These executions are identified with an unsigned integer called `scheduledExecutionId`.
 * - Permission: Unique identifier to refer to a user (who) that is allowed to perform an action (what) in a specific
 *   target contract (where). This identifier is called `permissionId` and is computed as
 *   `keccak256(actionId, account, where)`.
 */
contract TimelockAuthorizer is IAuthorizer, IAuthentication {
    using Address for address;

    uint256 public constant MAX_DELAY = 2 * (365 days);
    address public constant EVERYWHERE = address(-1);

    struct ScheduledExecution {
        address where;
        bytes data;
        bool executed;
        bool cancelled;
        bool protected;
        uint256 executableAt;
    }

    // solhint-disable var-name-mixedcase
    bytes32 public immutable GRANT_ACTION_ID;
    bytes32 public immutable REVOKE_ACTION_ID;
    bytes32 public immutable SCHEDULE_DELAY_ACTION_ID;

    IAuthentication private immutable _vault;
    ScheduledExecution[] public scheduledExecutions;
    mapping(bytes32 => bool) public isPermissionGranted;
    mapping(bytes32 => uint256) public delaysPerActionId;

    /**
     * @dev Emitted when a new action `actionId` is scheduled
     */
    event ExecutionScheduled(bytes32 indexed actionId, uint256 indexed scheduledExecutionId);

    /**
     * @dev Emitted when an action `actionId` is executed
     */
    event ActionExecuted(uint256 indexed scheduledExecutionId);

    /**
     * @dev Emitted when an action `actionId` is cancelled
     */
    event ActionCancelled(uint256 indexed scheduledExecutionId);

    /**
     * @dev Emitted when a new `delay` is set in order to perform action `actionId`
     */
    event ActionDelaySet(bytes32 indexed actionId, uint256 delay);

    /**
     * @dev Emitted when `account` is granted permission to perform action `actionId` in `where`.
     */
    event PermissionGranted(bytes32 indexed actionId, address indexed account, address indexed where);

    /**
     * @dev Emitted when an `account`'s permission to perform action `actionId` is revoked from `where`.
     */
    event PermissionRevoked(bytes32 indexed actionId, address indexed account, address indexed where);

    constructor(address admin, IAuthentication vault) {
        _vault = vault;
        GRANT_ACTION_ID = getActionId(TimelockAuthorizer.grantPermissions.selector);
        REVOKE_ACTION_ID = getActionId(TimelockAuthorizer.revokePermissions.selector);
        SCHEDULE_DELAY_ACTION_ID = getActionId(TimelockAuthorizer.scheduleDelayChange.selector);

        _grantPermission(getActionId(TimelockAuthorizer.grantPermissions.selector), admin, EVERYWHERE);
        _grantPermission(getActionId(TimelockAuthorizer.revokePermissions.selector), admin, EVERYWHERE);
    }

    /**
     * @dev Tells the action ID for a certain function selector
     */
    function getActionId(bytes4 selector) public view override returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(uint256(address(this))), selector));
    }

    function getVault() external view returns (address) {
        return address(_vault);
    }

    /**
     * @dev Tells the permission ID for action `actionId`, account `account` and target `where`
     */
    function permissionId(
        bytes32 actionId,
        address account,
        address where
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(actionId, account, where));
    }

    /**
     * @dev Tells whether `account` has explicit permission to perform action `actionId` in `where`
     */
    function hasPermission(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return
            isPermissionGranted[permissionId(actionId, account, where)] ||
            isPermissionGranted[permissionId(actionId, account, EVERYWHERE)];
    }

    /**
     * @dev Tells whether `account` can perform action `actionId` in `where`
     */
    function canPerform(
        bytes32 actionId,
        address account,
        address where
    ) public view override returns (bool) {
        return (delaysPerActionId[actionId] > 0) ? account == address(this) : hasPermission(actionId, account, where);
    }

    /**
     * @dev Sets a new delay for action `actionId`
     */
    function setDelay(bytes32 actionId, uint256 delay) external {
        _require(msg.sender == address(this), Errors.SENDER_NOT_ALLOWED);

        bytes32 setAuthorizerActionId = _vault.getActionId(IVault.setAuthorizer.selector);
        bool isAllowed = actionId == setAuthorizerActionId || delay <= delaysPerActionId[setAuthorizerActionId];
        require(isAllowed, "DELAY_EXCEEDS_SET_AUTHORIZER");

        delaysPerActionId[actionId] = delay;
        emit ActionDelaySet(actionId, delay);
    }

    /**
     * @dev Schedules a delay change of `newDelay` for action `actionId`
     */
    function scheduleDelayChange(
        bytes32 actionId,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256 scheduledExecutionId) {
        require(newDelay <= MAX_DELAY, "DELAY_TOO_LARGE");
        bytes32 scheduleDelayActionId = keccak256(abi.encodePacked(SCHEDULE_DELAY_ACTION_ID, actionId));
        _require(hasPermission(scheduleDelayActionId, msg.sender, address(this)), Errors.SENDER_NOT_ALLOWED);

        // The delay change is scheduled to execute after the current delay for the action has elapsed. This is
        // critical, as otherwise it'd be possible to execute an action with a delay shorter than its current one
        // by first changing it to a smaller (or zero) value.

        uint256 actionDelay = delaysPerActionId[actionId];
        bytes memory data = abi.encodeWithSelector(this.setDelay.selector, actionId, newDelay);
        return _scheduleWithDelay(scheduleDelayActionId, address(this), data, actionDelay, executors);
    }

    /**
     * @dev Schedules a new action
     */
    function schedule(
        address where,
        bytes memory data,
        address[] memory executors
    ) external returns (uint256 scheduledExecutionId) {
        require(where != address(this), "CANNOT_SCHEDULE_AUTHORIZER_ACTIONS");
        bytes32 actionId = IAuthentication(where).getActionId(_decodeSelector(data));
        _require(hasPermission(actionId, msg.sender, where), Errors.SENDER_NOT_ALLOWED);
        return _schedule(actionId, where, data, executors);
    }

    /**
     * @dev Executes a scheduled action `scheduledExecutionId`
     */
    function execute(uint256 scheduledExecutionId) external returns (bytes memory result) {
        require(scheduledExecutionId < scheduledExecutions.length, "ACTION_DOES_NOT_EXIST");
        ScheduledExecution storage scheduledExecution = scheduledExecutions[scheduledExecutionId];
        require(!scheduledExecution.executed, "ACTION_ALREADY_EXECUTED");
        require(!scheduledExecution.cancelled, "ACTION_ALREADY_CANCELLED");

        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp >= scheduledExecution.executableAt, "ACTION_NOT_EXECUTABLE");
        bytes32 executeActionId = _getExecuteActionId(scheduledExecutionId);
        bool isAllowed = !scheduledExecution.protected || hasPermission(executeActionId, msg.sender, address(this));
        _require(isAllowed, Errors.SENDER_NOT_ALLOWED);

        scheduledExecution.executed = true;
        result = scheduledExecution.where.functionCall(scheduledExecution.data);
        emit ActionExecuted(scheduledExecutionId);
    }

    /**
     * @dev Cancels a scheduled action `scheduledExecutionId`
     */
    function cancel(uint256 scheduledExecutionId) external {
        require(scheduledExecutionId < scheduledExecutions.length, "ACTION_DOES_NOT_EXIST");
        ScheduledExecution storage scheduledExecution = scheduledExecutions[scheduledExecutionId];

        require(!scheduledExecution.executed, "ACTION_ALREADY_EXECUTED");
        require(!scheduledExecution.cancelled, "ACTION_ALREADY_CANCELLED");

        // The permission to cancel a scheduled action is the same one used to schedule it
        IAuthentication target = IAuthentication(scheduledExecution.where);
        bytes32 actionId = target.getActionId(_decodeSelector(scheduledExecution.data));
        _require(hasPermission(actionId, msg.sender, scheduledExecution.where), Errors.SENDER_NOT_ALLOWED);

        scheduledExecution.cancelled = true;
        emit ActionCancelled(scheduledExecutionId);
    }

    /**
     * @dev Grants multiple permissions to a single account
     */
    function grantPermissions(
        bytes32[] memory actionIds,
        address account,
        address[] memory where
    ) external {
        InputHelpers.ensureInputLengthMatch(actionIds.length, where.length);
        for (uint256 i = 0; i < actionIds.length; i++) {
            _require(canPerform(GRANT_ACTION_ID, msg.sender, where[i]), Errors.SENDER_NOT_ALLOWED);
            _grantPermission(actionIds[i], account, where[i]);
        }
    }

    /**
     * @dev Schedules a grant permission to a single account
     */
    function scheduleGrantPermission(
        bytes32 actionId,
        address account,
        address where,
        address[] memory executors
    ) external returns (uint256 scheduledExecutionId) {
        _require(hasPermission(GRANT_ACTION_ID, msg.sender, where), Errors.SENDER_NOT_ALLOWED);
        bytes memory data = abi.encodeWithSelector(this.grantPermissions.selector, _ar(actionId), account, _ar(where));
        return _schedule(GRANT_ACTION_ID, address(this), data, executors);
    }

    /**
     * @dev Revokes multiple permissions from a single account
     */
    function revokePermissions(
        bytes32[] memory actionIds,
        address account,
        address[] memory where
    ) external {
        InputHelpers.ensureInputLengthMatch(actionIds.length, where.length);
        for (uint256 i = 0; i < actionIds.length; i++) {
            _require(canPerform(REVOKE_ACTION_ID, msg.sender, where[i]), Errors.SENDER_NOT_ALLOWED);
            _revokePermission(actionIds[i], account, where[i]);
        }
    }

    /**
     * @dev Schedules a revoke permission for a single account
     */
    function scheduleRevokePermission(
        bytes32 actionId,
        address account,
        address where,
        address[] memory executors
    ) external returns (uint256 scheduledExecutionId) {
        _require(hasPermission(REVOKE_ACTION_ID, msg.sender, where), Errors.SENDER_NOT_ALLOWED);
        bytes memory data = abi.encodeWithSelector(this.revokePermissions.selector, _ar(actionId), account, _ar(where));
        return _schedule(REVOKE_ACTION_ID, address(this), data, executors);
    }

    /**
     * @dev Renounces from multiple permissions
     */
    function renouncePermissions(bytes32[] memory actionIds, address[] memory where) external {
        InputHelpers.ensureInputLengthMatch(actionIds.length, where.length);
        for (uint256 i = 0; i < actionIds.length; i++) {
            _revokePermission(actionIds[i], msg.sender, where[i]);
        }
    }

    function _grantPermission(
        bytes32 actionId,
        address account,
        address where
    ) private {
        bytes32 permission = permissionId(actionId, account, where);
        if (!isPermissionGranted[permission]) {
            isPermissionGranted[permission] = true;
            emit PermissionGranted(actionId, account, where);
        }
    }

    function _revokePermission(
        bytes32 actionId,
        address account,
        address where
    ) private {
        bytes32 permission = permissionId(actionId, account, where);
        if (isPermissionGranted[permission]) {
            isPermissionGranted[permission] = false;
            emit PermissionRevoked(actionId, account, where);
        }
    }

    function _schedule(
        bytes32 actionId,
        address where,
        bytes memory data,
        address[] memory executors
    ) private returns (uint256 scheduledExecutionId) {
        uint256 delay = delaysPerActionId[actionId];
        require(delay > 0, "CANNOT_SCHEDULE_ACTION");
        return _scheduleWithDelay(actionId, where, data, delay, executors);
    }

    function _scheduleWithDelay(
        bytes32 actionId,
        address where,
        bytes memory data,
        uint256 delay,
        address[] memory executors
    ) private returns (uint256 scheduledExecutionId) {
        scheduledExecutionId = scheduledExecutions.length;
        emit ExecutionScheduled(actionId, scheduledExecutionId);

        // solhint-disable-next-line not-rely-on-time
        uint256 executableAt = block.timestamp + delay;
        bool protected = executors.length > 0;
        scheduledExecutions.push(ScheduledExecution(where, data, false, false, protected, executableAt));

        bytes32 executeActionId = _getExecuteActionId(scheduledExecutionId);
        for (uint256 i = 0; i < executors.length; i++) {
            _grantPermission(executeActionId, executors[i], address(this));
        }
    }

    function _getExecuteActionId(uint256 scheduledExecutionId) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(uint256(address(this))), this.execute.selector, scheduledExecutionId));
    }

    function _decodeSelector(bytes memory data) internal pure returns (bytes4) {
        // The bytes4 type is left-aligned and padded with zeros: we make use of that property to build the selector
        if (data.length < 4) return bytes4(0);
        return bytes4(data[0]) | (bytes4(data[1]) >> 8) | (bytes4(data[2]) >> 16) | (bytes4(data[3]) >> 24);
    }

    function _ar(bytes32 item) private pure returns (bytes32[] memory result) {
        result = new bytes32[](1);
        result[0] = item;
    }

    function _ar(address item) private pure returns (address[] memory result) {
        result = new address[](1);
        result[0] = item;
    }
}
