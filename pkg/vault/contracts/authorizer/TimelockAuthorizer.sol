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

import "./TimelockExecutor.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IAuthorizer.sol";

/**
 * @dev Basic Authorizer implementation using timelocks.
 *
 * Users are allowed to perform actions if they have the permission to do so.
 *
 * This Authorizer implementation allows defining a delay per action identifier. If a delay is set for an action, users
 * are now allowed to schedule an execution that will be triggered in the future by the Authorizer instead of executing
 * it directly themselves.
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
 *
 * Permission granularity:
 *   In addition to the who/what/where of a permission, an extra notion of "how" is introduced to enable more granular
 *   configuration. This concept is used within the Authorizer to provide clarity among four ambiguous actions:
 *   granting/revoking permissions, executing scheduled actions, and setting action delays. For example, in managing
 *   the permission to set action delays, it is desirable to delineate whether an account can set delays for all
 *   actions indiscriminately or only for a specific action ID. In this case, the permission's "what" is the action
 *   ID for scheduling a delay change, and the "how" is the action ID for which the delay will be changed. The "what"
 *   and "how" of a permission are combined into a single `actionId` by computing `keccak256(what, how)`.
 */
contract TimelockAuthorizer is IAuthorizer, IAuthentication {
    using Address for address;

    bytes32 public constant WHATEVER = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    address public constant EVERYWHERE = address(-1);
    uint256 public constant MAX_DELAY = 2 * (365 days);

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
    bytes32 public immutable EXECUTE_ACTION_ID;
    bytes32 public immutable SCHEDULE_DELAY_ACTION_ID;

    TimelockExecutor private immutable _executor;
    IAuthentication private immutable _vault;
    uint256 private immutable _rootTransferDelay;

    address public root;
    ScheduledExecution[] public scheduledExecutions;
    mapping(bytes32 => bool) public isPermissionGranted;
    mapping(bytes32 => uint256) public delaysPerActionId;

    /**
     * @dev Emitted when a new execution `scheduledExecutionId` is scheduled.
     */
    event ExecutionScheduled(bytes32 indexed actionId, uint256 indexed scheduledExecutionId);

    /**
     * @dev Emitted when an execution `scheduledExecutionId` is executed.
     */
    event ExecutionExecuted(uint256 indexed scheduledExecutionId);

    /**
     * @dev Emitted when an execution `scheduledExecutionId` is cancelled.
     */
    event ExecutionCancelled(uint256 indexed scheduledExecutionId);

    /**
     * @dev Emitted when a new `delay` is set in order to perform action `actionId`.
     */
    event ActionDelaySet(bytes32 indexed actionId, uint256 delay);

    /**
     * @dev Emitted when `account` is granted permission to perform action `actionId` in target `where`.
     */
    event PermissionGranted(bytes32 indexed actionId, address indexed account, address indexed where);

    /**
     * @dev Emitted when `account`'s permission to perform action `actionId` in target `where` is revoked.
     */
    event PermissionRevoked(bytes32 indexed actionId, address indexed account, address indexed where);

    /**
     * @dev Emitted when a new `root` is set.
     */
    event RootSet(address indexed root);

    modifier onlyExecutor() {
        _require(msg.sender == address(_executor), Errors.SENDER_NOT_ALLOWED);
        _;
    }

    constructor(
        address admin,
        IAuthentication vault,
        uint256 rootTransferDelay
    ) {
        root = admin;
        _vault = vault;
        _executor = new TimelockExecutor();
        _rootTransferDelay = rootTransferDelay;

        bytes32 grantActionId = getActionId(TimelockAuthorizer.grantPermissions.selector);
        _grantPermission(getActionId(grantActionId, WHATEVER), admin, EVERYWHERE);

        bytes32 revokeActionId = getActionId(TimelockAuthorizer.revokePermissions.selector);
        _grantPermission(getActionId(revokeActionId, WHATEVER), admin, EVERYWHERE);

        GRANT_ACTION_ID = grantActionId;
        REVOKE_ACTION_ID = revokeActionId;
        EXECUTE_ACTION_ID = getActionId(TimelockAuthorizer.execute.selector);
        SCHEDULE_DELAY_ACTION_ID = getActionId(TimelockAuthorizer.scheduleDelayChange.selector);
    }

    /**
     * @dev Returns true if `account` is the root.
     */
    function isRoot(address account) public view returns (bool) {
        return account == root;
    }

    /**
     * @dev Returns the delay required to transfer the root address.
     */
    function getRootTransferDelay() public view returns (uint256) {
        return _rootTransferDelay;
    }

    /**
     * @dev Returns the vault address.
     */
    function getVault() external view returns (address) {
        return address(_vault);
    }

    /**
     * @dev Returns the executor address.
     */
    function getExecutor() external view returns (address) {
        return address(_executor);
    }

    /**
     * @dev Returns the action ID for function selector `selector`.
     */
    function getActionId(bytes4 selector) public view override returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(uint256(address(this))), selector));
    }

    /**
     * @dev Returns the action ID for action `actionId` with specific params `how`.
     */
    function getActionId(bytes32 actionId, bytes32 how) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(actionId, how));
    }

    /**
     * @dev Returns the permission ID for action `actionId`, account `account` and target `where`.
     */
    function permissionId(
        bytes32 actionId,
        address account,
        address where
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(actionId, account, where));
    }

    /**
     * @dev Returns true if `account` is allowed to perform action `actionId` in target `where`.
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
     * @dev Returns true if `account` is allowed to grant permissions for action `actionId` in target `where`.
     */
    function isGranter(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return _hasPermissionOrWhatever(GRANT_ACTION_ID, account, where, actionId);
    }

    /**
     * @dev Returns true if `account` is allowed to revoke permissions for action `actionId` in target `where`.
     */
    function isRevoker(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return _hasPermissionOrWhatever(REVOKE_ACTION_ID, account, where, actionId);
    }

    /**
     * @dev Returns true if `account` can perform action `actionId` in target `where`.
     */
    function canPerform(
        bytes32 actionId,
        address account,
        address where
    ) public view override returns (bool) {
        return
            (delaysPerActionId[actionId] > 0) ? account == address(_executor) : hasPermission(actionId, account, where);
    }

    /**
     * @dev Returns true if `account` can grant permissions for action `actionId` in target `where`.
     */
    function canGrant(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return _canPerformOrWhatever(GRANT_ACTION_ID, account, where, actionId);
    }

    /**
     * @dev Returns true if `account` can revoke permissions for action `actionId` in target `where`.
     */
    function canRevoke(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return _canPerformOrWhatever(REVOKE_ACTION_ID, account, where, actionId);
    }

    /**
     * @dev Returns true if execution `scheduledExecutionId` can be executed.
     * Only true if it is not already executed or cancelled, and if the execution delay has passed.
     */
    function canExecute(uint256 scheduledExecutionId) external view returns (bool) {
        require(scheduledExecutionId < scheduledExecutions.length, "ACTION_DOES_NOT_EXIST");
        ScheduledExecution storage scheduledExecution = scheduledExecutions[scheduledExecutionId];
        return
            !scheduledExecution.executed &&
            !scheduledExecution.cancelled &&
            block.timestamp >= scheduledExecution.executableAt;
        // solhint-disable-previous-line not-rely-on-time
    }

    /**
     * @dev Sets the root address to `newRoot`.
     */
    function setRoot(address newRoot) external onlyExecutor {
        root = newRoot;
        emit RootSet(newRoot);
    }

    /**
     * @dev Schedules an execution to change the root address to `newRoot`.
     */
    function scheduleRootChange(address newRoot, address[] memory executors)
        external
        returns (uint256 scheduledExecutionId)
    {
        _require(isRoot(msg.sender), Errors.SENDER_NOT_ALLOWED);
        bytes32 actionId = getActionId(this.setRoot.selector);
        bytes32 scheduleRootChangeActionId = getActionId(SCHEDULE_DELAY_ACTION_ID, actionId);
        bytes memory data = abi.encodeWithSelector(this.setRoot.selector, newRoot);
        return _scheduleWithDelay(scheduleRootChangeActionId, address(this), data, _rootTransferDelay, executors);
    }

    /**
     * @dev Sets a new delay `delay` for action `actionId`.
     */
    function setDelay(bytes32 actionId, uint256 delay) external onlyExecutor {
        bytes32 setAuthorizerActionId = _vault.getActionId(IVault.setAuthorizer.selector);
        bool isAllowed = actionId == setAuthorizerActionId || delay <= delaysPerActionId[setAuthorizerActionId];
        require(isAllowed, "DELAY_EXCEEDS_SET_AUTHORIZER");

        delaysPerActionId[actionId] = delay;
        emit ActionDelaySet(actionId, delay);
    }

    /**
     * @dev Schedules an execution to set action `actionId`'s delay to `newDelay`.
     */
    function scheduleDelayChange(
        bytes32 actionId,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256 scheduledExecutionId) {
        require(newDelay <= MAX_DELAY, "DELAY_TOO_LARGE");
        bool isAllowed = _hasPermissionOrWhatever(SCHEDULE_DELAY_ACTION_ID, msg.sender, address(this), actionId);
        _require(isAllowed, Errors.SENDER_NOT_ALLOWED);

        // The delay change is scheduled to execute after the current delay for the action has elapsed. This is
        // critical, as otherwise it'd be possible to execute an action with a delay shorter than its current one
        // by first changing it to a smaller (or zero) value.

        uint256 actionDelay = delaysPerActionId[actionId];
        bytes32 scheduleDelayActionId = getActionId(SCHEDULE_DELAY_ACTION_ID, actionId);
        bytes memory data = abi.encodeWithSelector(this.setDelay.selector, actionId, newDelay);
        return _scheduleWithDelay(scheduleDelayActionId, address(this), data, actionDelay, executors);
    }

    /**
     * @dev Schedules an arbitrary execution of `data` in target `where`.
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
     * @dev Executes a scheduled action `scheduledExecutionId`.
     */
    function execute(uint256 scheduledExecutionId) external returns (bytes memory result) {
        require(scheduledExecutionId < scheduledExecutions.length, "ACTION_DOES_NOT_EXIST");
        ScheduledExecution storage scheduledExecution = scheduledExecutions[scheduledExecutionId];
        require(!scheduledExecution.executed, "ACTION_ALREADY_EXECUTED");
        require(!scheduledExecution.cancelled, "ACTION_ALREADY_CANCELLED");

        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp >= scheduledExecution.executableAt, "ACTION_NOT_EXECUTABLE");
        if (scheduledExecution.protected) {
            bytes32 executeScheduledActionId = getActionId(EXECUTE_ACTION_ID, bytes32(scheduledExecutionId));
            bool isAllowed = hasPermission(executeScheduledActionId, msg.sender, address(this));
            _require(isAllowed, Errors.SENDER_NOT_ALLOWED);
        }

        scheduledExecution.executed = true;
        result = _executor.execute(scheduledExecution.where, scheduledExecution.data);
        emit ExecutionExecuted(scheduledExecutionId);
    }

    /**
     * @dev Cancels a scheduled action `scheduledExecutionId`.
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
        emit ExecutionCancelled(scheduledExecutionId);
    }

    /**
     * @dev Sets `account`'s granter status to `allowed` for action `actionId` in target `where`.
     * Note that pairs can manage themselves, even banning the root, but the root can allow itself back at any time.
     */
    function manageGranter(
        bytes32 actionId,
        address account,
        address where,
        bool allowed
    ) external {
        bool isAllowed = isRoot(msg.sender) || isGranter(actionId, msg.sender, where);
        _require(isAllowed, Errors.SENDER_NOT_ALLOWED);
        bytes32 grantPermissionsActionId = getActionId(GRANT_ACTION_ID, actionId);
        (allowed ? _grantPermission : _revokePermission)(grantPermissionsActionId, account, where);
    }

    /**
     * @dev Grants multiple permissions to a single `account`.
     */
    function grantPermissions(
        bytes32[] memory actionIds,
        address account,
        address[] memory where
    ) external {
        InputHelpers.ensureInputLengthMatch(actionIds.length, where.length);
        for (uint256 i = 0; i < actionIds.length; i++) {
            _require(canGrant(actionIds[i], msg.sender, where[i]), Errors.SENDER_NOT_ALLOWED);
            _grantPermission(actionIds[i], account, where[i]);
        }
    }

    /**
     * @dev Schedules a grant permission to `account` for action `actionId` in target `where`.
     */
    function scheduleGrantPermission(
        bytes32 actionId,
        address account,
        address where,
        address[] memory executors
    ) external returns (uint256 scheduledExecutionId) {
        _require(isGranter(actionId, msg.sender, where), Errors.SENDER_NOT_ALLOWED);
        bytes memory data = abi.encodeWithSelector(this.grantPermissions.selector, _ar(actionId), account, _ar(where));
        bytes32 grantPermissionId = getActionId(GRANT_ACTION_ID, actionId);
        return _schedule(grantPermissionId, address(this), data, executors);
    }

    /**
     * @dev Sets `account`'s revoker status to `allowed` for action `actionId` in target `where`.
     * Note that pairs can manage themselves, even banning the root, but the root can allow himself back at any time
     */
    function manageRevoker(
        bytes32 actionId,
        address account,
        address where,
        bool allowed
    ) external {
        bool isAllowed = isRoot(msg.sender) || isRevoker(actionId, msg.sender, where);
        _require(isAllowed, Errors.SENDER_NOT_ALLOWED);
        bytes32 revokePermissionsActionId = getActionId(REVOKE_ACTION_ID, actionId);
        (allowed ? _grantPermission : _revokePermission)(revokePermissionsActionId, account, where);
    }

    /**
     * @dev Revokes multiple permissions from a single `account`.
     */
    function revokePermissions(
        bytes32[] memory actionIds,
        address account,
        address[] memory where
    ) external {
        InputHelpers.ensureInputLengthMatch(actionIds.length, where.length);
        for (uint256 i = 0; i < actionIds.length; i++) {
            _require(canRevoke(actionIds[i], msg.sender, where[i]), Errors.SENDER_NOT_ALLOWED);
            _revokePermission(actionIds[i], account, where[i]);
        }
    }

    /**
     * @dev Schedules a revoke permission from `account` for action `actionId` in target `where`.
     */
    function scheduleRevokePermission(
        bytes32 actionId,
        address account,
        address where,
        address[] memory executors
    ) external returns (uint256 scheduledExecutionId) {
        _require(isRevoker(actionId, msg.sender, where), Errors.SENDER_NOT_ALLOWED);
        bytes memory data = abi.encodeWithSelector(this.revokePermissions.selector, _ar(actionId), account, _ar(where));
        bytes32 revokePermissionId = getActionId(REVOKE_ACTION_ID, actionId);
        return _schedule(revokePermissionId, address(this), data, executors);
    }

    /**
     * @dev Revokes multiple permissions from the caller.
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

        bytes32 executeActionId = getActionId(EXECUTE_ACTION_ID, bytes32(scheduledExecutionId));
        for (uint256 i = 0; i < executors.length; i++) {
            _grantPermission(executeActionId, executors[i], address(this));
        }
    }

    function _hasPermissionOrWhatever(
        bytes32 actionId,
        address account,
        address where,
        bytes32 how
    ) internal view returns (bool) {
        bytes32 granularActionId = getActionId(actionId, how);
        bytes32 globalActionId = getActionId(actionId, WHATEVER);
        return hasPermission(granularActionId, account, where) || hasPermission(globalActionId, account, where);
    }

    function _canPerformOrWhatever(
        bytes32 actionId,
        address account,
        address where,
        bytes32 how
    ) internal view returns (bool) {
        // If there is a delay defined for the granular action ID, then the sender must be the authorizer (scheduled
        // execution)
        bytes32 granularActionId = getActionId(actionId, how);
        if (delaysPerActionId[granularActionId] > 0) {
            return account == address(_executor);
        }

        // If there is no delay, we check if the account has that permission
        if (hasPermission(granularActionId, account, where)) {
            return true;
        }

        // If the account doesn't have the explicit permission, we repeat for the global permission
        bytes32 globalActionId = getActionId(actionId, WHATEVER);
        return canPerform(globalActionId, account, where);
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
