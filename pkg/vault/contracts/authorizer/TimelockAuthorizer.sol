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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/IAuthentication.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IAuthorizer.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "./TimelockExecutor.sol";

/**
 * @title Timelock Authorizer
 * @author Balancer Labs
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
 *   In addition to the who/what/where of a permission, an extra notion of a "specifier" is introduced to enable more
 *   granular configuration. This concept is used within the Authorizer to provide clarity among four ambiguous actions:
 *   granting/revoking permissions, executing scheduled actions, and setting action delays. For example, in managing
 *   the permission to set action delays, it is desirable to delineate whether an account can set delays for all
 *   actions indiscriminately or only for a specific action ID. In this case, the permission's "baseActionId" is the
 *   action ID for scheduling a delay change, and the "specifier" is the action ID for which the delay will be changed.
 *   The "baseActionId" and "specifier" of a permission are combined into a single "extended" `actionId`
 *   by calling `getExtendedActionId(baseActionId, specifier)`.
 */
contract TimelockAuthorizer is IAuthorizer, IAuthentication {
    using Address for address;

    /**
     * @notice An action specifier which grants a general permission to perform all variants of the base action.
     */
    bytes32
        public constant GENERAL_PERMISSION_SPECIFIER = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    // solhint-disable-previous-line max-line-length

    address public constant EVERYWHERE = address(-1);

    // We institute a maximum delay to ensure that actions cannot be accidentally/maliciously disabled through setting
    // an arbitrarily long delay.
    uint256 public constant MAX_DELAY = 2 * (365 days);
    // We need a minimum delay period to ensure that scheduled actions may be properly scrutinised.
    uint256 public constant MIN_DELAY = 3 days;

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

    // These action ids do not need to be used by external actors as the action ids above do.
    // Instead they're saved just for gas savings so we can keep them private.
    bytes32 private immutable _GENERAL_GRANT_ACTION_ID;
    bytes32 private immutable _GENERAL_REVOKE_ACTION_ID;

    TimelockExecutor private immutable _executor;
    IAuthentication private immutable _vault;
    uint256 private immutable _rootTransferDelay;

    address private _root;
    address private _pendingRoot;
    ScheduledExecution[] private _scheduledExecutions;
    mapping(bytes32 => bool) private _isPermissionGranted;
    mapping(bytes32 => uint256) private _delaysPerActionId;

    /**
     * @notice Emitted when a new execution `scheduledExecutionId` is scheduled.
     */
    event ExecutionScheduled(bytes32 indexed actionId, uint256 indexed scheduledExecutionId);

    /**
     * @notice Emitted when an execution `scheduledExecutionId` is executed.
     */
    event ExecutionExecuted(uint256 indexed scheduledExecutionId);

    /**
     * @notice Emitted when an execution `scheduledExecutionId` is cancelled.
     */
    event ExecutionCancelled(uint256 indexed scheduledExecutionId);

    /**
     * @notice Emitted when a new `delay` is set in order to perform action `actionId`.
     */
    event ActionDelaySet(bytes32 indexed actionId, uint256 delay);

    /**
     * @notice Emitted when `account` is granted permission to perform action `actionId` in target `where`.
     */
    event PermissionGranted(bytes32 indexed actionId, address indexed account, address indexed where);

    /**
     * @notice Emitted when `account`'s permission to perform action `actionId` in target `where` is revoked.
     */
    event PermissionRevoked(bytes32 indexed actionId, address indexed account, address indexed where);

    /**
     * @notice Emitted when a new `root` is set.
     */
    event RootSet(address indexed root);

    /**
     * @notice Emitted when a new `pendingRoot` is set. The new account must claim ownership for it to take effect.
     */
    event PendingRootSet(address indexed pendingRoot);

    modifier onlyExecutor() {
        _require(msg.sender == address(_executor), Errors.SENDER_NOT_ALLOWED);
        _;
    }

    constructor(
        address admin,
        IAuthentication vault,
        uint256 rootTransferDelay
    ) {
        _setRoot(admin);
        _vault = vault;
        _executor = new TimelockExecutor();
        _rootTransferDelay = rootTransferDelay;

        bytes32 grantActionId = getActionId(TimelockAuthorizer.grantPermissions.selector);
        bytes32 revokeActionId = getActionId(TimelockAuthorizer.revokePermissions.selector);
        bytes32 generalGrantActionId = getExtendedActionId(grantActionId, GENERAL_PERMISSION_SPECIFIER);
        bytes32 generalRevokeActionId = getExtendedActionId(revokeActionId, GENERAL_PERMISSION_SPECIFIER);

        _grantPermission(generalGrantActionId, admin, EVERYWHERE);
        _grantPermission(generalRevokeActionId, admin, EVERYWHERE);

        GRANT_ACTION_ID = grantActionId;
        REVOKE_ACTION_ID = revokeActionId;
        EXECUTE_ACTION_ID = getActionId(TimelockAuthorizer.execute.selector);
        SCHEDULE_DELAY_ACTION_ID = getActionId(TimelockAuthorizer.scheduleDelayChange.selector);
        _GENERAL_GRANT_ACTION_ID = generalGrantActionId;
        _GENERAL_REVOKE_ACTION_ID = generalRevokeActionId;
    }

    /**
     * @notice Returns true if `account` is the root.
     */
    function isRoot(address account) public view returns (bool) {
        return account == _root;
    }

    /**
     * @notice Returns true if `account` is the pending root.
     */
    function isPendingRoot(address account) public view returns (bool) {
        return account == _pendingRoot;
    }

    /**
     * @notice Returns the delay required to transfer the root address.
     */
    function getRootTransferDelay() public view returns (uint256) {
        return _rootTransferDelay;
    }

    /**
     * @notice Returns the vault address.
     */
    function getVault() external view returns (address) {
        return address(_vault);
    }

    /**
     * @notice Returns the executor address.
     */
    function getExecutor() external view returns (address) {
        return address(_executor);
    }

    /**
     * @notice Returns the root address.
     */
    function getRoot() external view returns (address) {
        return _root;
    }

    /**
     * @notice Returns the currently pending new root address.
     */
    function getPendingRoot() external view returns (address) {
        return _pendingRoot;
    }

    /**
     * @notice Returns the action ID for function selector `selector`.
     */
    function getActionId(bytes4 selector) public view override returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(uint256(address(this))), selector));
    }

    /**
     * @notice Returns the action ID for granting a permission for action `actionId`.
     */
    function getGrantPermissionActionId(bytes32 actionId) public view returns (bytes32) {
        return getExtendedActionId(GRANT_ACTION_ID, actionId);
    }

    /**
     * @notice Returns the action ID for revoking a permission for action `actionId`.
     */
    function getRevokePermissionActionId(bytes32 actionId) public view returns (bytes32) {
        return getExtendedActionId(REVOKE_ACTION_ID, actionId);
    }

    /**
     * @notice Returns the action ID for executing the scheduled action with execution ID `executionId`.
     */
    function getExecuteExecutionActionId(uint256 executionId) public view returns (bytes32) {
        return getExtendedActionId(EXECUTE_ACTION_ID, bytes32(executionId));
    }

    /**
     * @notice Returns the action ID for scheduling setting a new delay for action `actionId`.
     */
    function getScheduleDelayActionId(bytes32 actionId) public view returns (bytes32) {
        return getExtendedActionId(SCHEDULE_DELAY_ACTION_ID, actionId);
    }

    /**
     * @notice Returns the extended action ID for base action ID `baseActionId` with specific params `specifier`.
     */
    function getExtendedActionId(bytes32 baseActionId, bytes32 specifier) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(baseActionId, specifier));
    }

    /**
     * @notice Returns the execution delay for action `actionId`.
     */
    function getActionIdDelay(bytes32 actionId) external view returns (uint256) {
        return _delaysPerActionId[actionId];
    }

    /**
     * @notice Returns the permission ID for action `actionId`, account `account` and target `where`.
     */
    function permissionId(
        bytes32 actionId,
        address account,
        address where
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(actionId, account, where));
    }

    /**
     * @notice Returns true if `account` has the permission defined by action `actionId` and target `where`.
     * @dev This function is specific for the strict permission defined by the tuple `(actionId, where)`, `account` may
     * also hold the global permission for the action `actionId` allowing them to perform the action on `where`.
     *
     * For this reason, it's recommended to use `hasPermission` if checking whether `account` is allowed to perform
     * a given action.
     */
    function isPermissionGrantedOnTarget(
        bytes32 actionId,
        address account,
        address where
    ) external view returns (bool) {
        return _isPermissionGranted[permissionId(actionId, account, where)];
    }

    /**
     * @notice Returns true if `account` is allowed to perform action `actionId` in target `where`.
     */
    function hasPermission(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return
            _isPermissionGranted[permissionId(actionId, account, where)] ||
            _isPermissionGranted[permissionId(actionId, account, EVERYWHERE)];
    }

    /**
     * @notice Returns true if `account` is allowed to grant permissions for action `actionId` in target `where`.
     */
    function isGranter(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return _hasPermissionSpecificallyOrGenerally(GRANT_ACTION_ID, account, where, actionId);
    }

    /**
     * @notice Returns true if `account` is allowed to revoke permissions for action `actionId` in target `where`.
     */
    function isRevoker(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return _hasPermissionSpecificallyOrGenerally(REVOKE_ACTION_ID, account, where, actionId);
    }

    /**
     * @notice Returns true if `account` can perform action `actionId` in target `where`.
     */
    function canPerform(
        bytes32 actionId,
        address account,
        address where
    ) public view override returns (bool) {
        return
            _delaysPerActionId[actionId] > 0 ? account == address(_executor) : hasPermission(actionId, account, where);
    }

    /**
     * @notice Returns true if `account` can grant permissions for action `actionId` in target `where`.
     */
    function canGrant(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return _canPerformSpecificallyOrGenerally(GRANT_ACTION_ID, account, where, actionId);
    }

    /**
     * @notice Returns true if `account` can revoke permissions for action `actionId` in target `where`.
     */
    function canRevoke(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return _canPerformSpecificallyOrGenerally(REVOKE_ACTION_ID, account, where, actionId);
    }

    /**
     * @notice Returns the scheduled execution `scheduledExecutionId`.
     */
    function getScheduledExecution(uint256 scheduledExecutionId) external view returns (ScheduledExecution memory) {
        return _scheduledExecutions[scheduledExecutionId];
    }

    /**
     * @notice Returns true if execution `scheduledExecutionId` can be executed.
     * Only true if it is not already executed or cancelled, and if the execution delay has passed.
     */
    function canExecute(uint256 scheduledExecutionId) external view returns (bool) {
        require(scheduledExecutionId < _scheduledExecutions.length, "ACTION_DOES_NOT_EXIST");
        ScheduledExecution storage scheduledExecution = _scheduledExecutions[scheduledExecutionId];
        return
            !scheduledExecution.executed &&
            !scheduledExecution.cancelled &&
            block.timestamp >= scheduledExecution.executableAt;
        // solhint-disable-previous-line not-rely-on-time
    }

    /**
     * @notice Schedules an execution to change the root address to `newRoot`.
     */
    function scheduleRootChange(address newRoot, address[] memory executors)
        external
        returns (uint256 scheduledExecutionId)
    {
        _require(isRoot(msg.sender), Errors.SENDER_NOT_ALLOWED);
        bytes32 actionId = getActionId(this.setPendingRoot.selector);
        bytes memory data = abi.encodeWithSelector(this.setPendingRoot.selector, newRoot);
        return _scheduleWithDelay(actionId, address(this), data, getRootTransferDelay(), executors);
    }

    /**
     * @notice Sets the pending root address to `pendingRoot`.
     * @dev Once set as the pending root, `pendingRoot` may then call `claimRoot` to become the new root.
     */
    function setPendingRoot(address pendingRoot) external onlyExecutor {
        _setPendingRoot(pendingRoot);
    }

    /**
     * @notice Transfers root powers from the current to the pending root address.
     * @dev This function prevents accidentally transferring root to an invalid address.
     * To become root, the pending root must call this function to ensure that it's able to interact with this contract.
     */
    function claimRoot() external {
        address currentRoot = _root;
        address pendingRoot = _pendingRoot;
        _require(msg.sender == pendingRoot, Errors.SENDER_NOT_ALLOWED);

        // Grant powers to new root to grant or revoke any permission over any contract.
        _grantPermission(_GENERAL_GRANT_ACTION_ID, pendingRoot, EVERYWHERE);
        _grantPermission(_GENERAL_REVOKE_ACTION_ID, pendingRoot, EVERYWHERE);

        // Revoke these powers from the outgoing root.
        _revokePermission(_GENERAL_GRANT_ACTION_ID, currentRoot, EVERYWHERE);
        _revokePermission(_GENERAL_REVOKE_ACTION_ID, currentRoot, EVERYWHERE);

        // Complete the root transfer and reset the pending root.
        _setRoot(pendingRoot);
        _setPendingRoot(address(0));
    }

    /**
     * @notice Sets a new delay `delay` for action `actionId`.
     */
    function setDelay(bytes32 actionId, uint256 delay) external onlyExecutor {
        bytes32 setAuthorizerActionId = _vault.getActionId(IVault.setAuthorizer.selector);
        bool isAllowed = actionId == setAuthorizerActionId || delay <= _delaysPerActionId[setAuthorizerActionId];
        require(isAllowed, "DELAY_EXCEEDS_SET_AUTHORIZER");

        _delaysPerActionId[actionId] = delay;
        emit ActionDelaySet(actionId, delay);
    }

    /**
     * @notice Schedules an execution to set action `actionId`'s delay to `newDelay`.
     */
    function scheduleDelayChange(
        bytes32 actionId,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256 scheduledExecutionId) {
        require(newDelay <= MAX_DELAY, "DELAY_TOO_LARGE");
        _require(isRoot(msg.sender), Errors.SENDER_NOT_ALLOWED);

        // The delay change is scheduled so that it's never possible to execute an action in a shorter time than the
        // current delay.
        //
        // If we're reducing the action's delay then we must first wait for the difference between the two delays.
        // This means that if we immediately schedule the action for execution once the delay is reduced, then
        // these two delays combined will result in the original delay.
        //
        // If we're increasing the delay on an action, we could execute this change immediately as it's impossible to
        // perform an action sooner by increasing its delay. Requiring a potentially long delay before increasing the
        // delay just adds unnecessary friction to increasing security for sensitive actions.
        //
        // In practice, we enforce a minimum delay period to allow proper scrutiny of the change of the action's delay.

        uint256 actionDelay = _delaysPerActionId[actionId];
        uint256 executionDelay = newDelay < actionDelay ? Math.max(actionDelay - newDelay, MIN_DELAY) : MIN_DELAY;

        bytes32 scheduleDelayActionId = getScheduleDelayActionId(actionId);
        bytes memory data = abi.encodeWithSelector(this.setDelay.selector, actionId, newDelay);
        return _scheduleWithDelay(scheduleDelayActionId, address(this), data, executionDelay, executors);
    }

    /**
     * @notice Schedules an arbitrary execution of `data` in target `where`.
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
     * @notice Executes a scheduled action `scheduledExecutionId`.
     */
    function execute(uint256 scheduledExecutionId) external returns (bytes memory result) {
        require(scheduledExecutionId < _scheduledExecutions.length, "ACTION_DOES_NOT_EXIST");
        ScheduledExecution storage scheduledExecution = _scheduledExecutions[scheduledExecutionId];
        require(!scheduledExecution.executed, "ACTION_ALREADY_EXECUTED");
        require(!scheduledExecution.cancelled, "ACTION_ALREADY_CANCELLED");

        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp >= scheduledExecution.executableAt, "ACTION_NOT_EXECUTABLE");
        if (scheduledExecution.protected) {
            bytes32 executeScheduledActionId = getExecuteExecutionActionId(scheduledExecutionId);
            bool isAllowed = hasPermission(executeScheduledActionId, msg.sender, address(this));
            _require(isAllowed, Errors.SENDER_NOT_ALLOWED);
        }

        scheduledExecution.executed = true;
        result = _executor.execute(scheduledExecution.where, scheduledExecution.data);
        emit ExecutionExecuted(scheduledExecutionId);
    }

    /**
     * @notice Cancels a scheduled action `scheduledExecutionId`.
     * @dev The permission to cancel a scheduled action is the same one used to schedule it.
     *
     * Note that in the case of cancelling a malicious granting or revocation of permissions to an address,
     * we must assume that the granter/revoker status of all non-malicious addresses will be revoked as calls to
     * manageGranter/manageRevoker have no delays associated with them.
     */
    function cancel(uint256 scheduledExecutionId) external {
        require(scheduledExecutionId < _scheduledExecutions.length, "ACTION_DOES_NOT_EXIST");
        ScheduledExecution storage scheduledExecution = _scheduledExecutions[scheduledExecutionId];

        require(!scheduledExecution.executed, "ACTION_ALREADY_EXECUTED");
        require(!scheduledExecution.cancelled, "ACTION_ALREADY_CANCELLED");

        // The permission to cancel a scheduled action is the same one used to schedule it.
        // The root address may cancel any action even without this permission.
        IAuthentication target = IAuthentication(scheduledExecution.where);
        bytes32 actionId = target.getActionId(_decodeSelector(scheduledExecution.data));
        _require(
            hasPermission(actionId, msg.sender, scheduledExecution.where) || isRoot(msg.sender),
            Errors.SENDER_NOT_ALLOWED
        );

        scheduledExecution.cancelled = true;
        emit ExecutionCancelled(scheduledExecutionId);
    }

    /**
     * @notice Sets `account`'s granter status to `allowed` for action `actionId` in target `where`.
     * @dev Note that granters can revoke the granter status of other granters, even removing the root.
     * However the root can always rejoin, and then remove any malicious granters.
     *
     * Note that there are no delays associated with adding or removing granters. This is based on the assumption that
     * any action which a malicous user could exploit to damage the protocol will have a sufficiently long delay
     * associated with either granting permission for or exercising that permission such that the root will be able to
     * reestablish control and cancel the action before it can be executed.
     */
    function manageGranter(
        bytes32 actionId,
        address account,
        address where,
        bool allowed
    ) external {
        // Root may grant or revoke granter status from any address.
        // Granters may only revoke a granter status from any address.
        bool isAllowed = isRoot(msg.sender) || (!allowed && isGranter(actionId, msg.sender, where));
        _require(isAllowed, Errors.SENDER_NOT_ALLOWED);

        bytes32 grantPermissionsActionId = getGrantPermissionActionId(actionId);
        (allowed ? _grantPermission : _revokePermission)(grantPermissionsActionId, account, where);
    }

    /**
     * @notice Grants multiple permissions to a single `account`.
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
     * @notice Schedules a grant permission to `account` for action `actionId` in target `where`.
     */
    function scheduleGrantPermission(
        bytes32 actionId,
        address account,
        address where,
        address[] memory executors
    ) external returns (uint256 scheduledExecutionId) {
        _require(isGranter(actionId, msg.sender, where), Errors.SENDER_NOT_ALLOWED);
        bytes memory data = abi.encodeWithSelector(this.grantPermissions.selector, _ar(actionId), account, _ar(where));
        bytes32 grantPermissionId = getGrantPermissionActionId(actionId);
        return _schedule(grantPermissionId, address(this), data, executors);
    }

    /**
     * @notice Sets `account`'s revoker status to `allowed` for action `actionId` in target `where`.
     * @dev Note that revokers can revoke the revoker status of other revokers, even banning the root.
     * However the root can always rejoin, and then remove any malicious revokers.
     *
     * Note that there are no delays associated with adding or removing revokers. This is based on the assumption that
     * any permissions for which revocation from key addresses would be dangerous (e.g. preventing the BalancerMinter
     * from minting BAL) have sufficiently long delays associated with revoking them that the root will be able to
     * reestablish control and cancel the revocation before the scheduled revocation can be executed.
     */
    function manageRevoker(
        bytes32 actionId,
        address account,
        address where,
        bool allowed
    ) external {
        // Root may grant or revoke revoker status from any address.
        // Revokers may only revoke a revoker status from any address.
        bool isAllowed = isRoot(msg.sender) || (!allowed && isRevoker(actionId, msg.sender, where));
        _require(isAllowed, Errors.SENDER_NOT_ALLOWED);

        bytes32 revokePermissionsActionId = getRevokePermissionActionId(actionId);
        (allowed ? _grantPermission : _revokePermission)(revokePermissionsActionId, account, where);
    }

    /**
     * @notice Revokes multiple permissions from a single `account`.
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
     * @notice Schedules a revoke permission from `account` for action `actionId` in target `where`.
     */
    function scheduleRevokePermission(
        bytes32 actionId,
        address account,
        address where,
        address[] memory executors
    ) external returns (uint256 scheduledExecutionId) {
        _require(isRevoker(actionId, msg.sender, where), Errors.SENDER_NOT_ALLOWED);
        bytes memory data = abi.encodeWithSelector(this.revokePermissions.selector, _ar(actionId), account, _ar(where));
        bytes32 revokePermissionId = getRevokePermissionActionId(actionId);
        return _schedule(revokePermissionId, address(this), data, executors);
    }

    /**
     * @notice Revokes multiple permissions from the caller.
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
        if (!_isPermissionGranted[permission]) {
            _isPermissionGranted[permission] = true;
            emit PermissionGranted(actionId, account, where);
        }
    }

    function _revokePermission(
        bytes32 actionId,
        address account,
        address where
    ) private {
        bytes32 permission = permissionId(actionId, account, where);
        if (_isPermissionGranted[permission]) {
            _isPermissionGranted[permission] = false;
            emit PermissionRevoked(actionId, account, where);
        }
    }

    function _schedule(
        bytes32 actionId,
        address where,
        bytes memory data,
        address[] memory executors
    ) private returns (uint256 scheduledExecutionId) {
        uint256 delay = _delaysPerActionId[actionId];
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
        scheduledExecutionId = _scheduledExecutions.length;
        emit ExecutionScheduled(actionId, scheduledExecutionId);

        // solhint-disable-next-line not-rely-on-time
        uint256 executableAt = block.timestamp + delay;
        bool protected = executors.length > 0;
        _scheduledExecutions.push(ScheduledExecution(where, data, false, false, protected, executableAt));

        bytes32 executeActionId = getExecuteExecutionActionId(scheduledExecutionId);
        for (uint256 i = 0; i < executors.length; i++) {
            _grantPermission(executeActionId, executors[i], address(this));
        }
    }

    /**
     * @notice Returns if `account` has permission to perform the action `(baseActionId, specifier)` on target `where`.
     * @dev This function differs from `_canPerformSpecificallyOrGenerally` as it *doesn't* take into account whether
     * there is a delay for the action associated with the permission being checked.
     *
     * The address `account` may have the permission associated with the provided action but that doesn't necessarily
     * mean that it may perform that action. If there is no delay associated with this action, `account` may perform the
     * action directly. If there is a delay, then `account` is instead able to schedule that action to be performed
     * at a later date.
     *
     * This function returns true in both cases.
     */
    function _hasPermissionSpecificallyOrGenerally(
        bytes32 baseActionId,
        address account,
        address where,
        bytes32 specifier
    ) internal view returns (bool) {
        bytes32 specificActionId = getExtendedActionId(baseActionId, specifier);
        bytes32 generalActionId = getExtendedActionId(baseActionId, GENERAL_PERMISSION_SPECIFIER);
        return hasPermission(specificActionId, account, where) || hasPermission(generalActionId, account, where);
    }

    /**
     * @notice Returns if `account` can perform the action `(baseActionId, specifier)` on target `where`.
     * @dev This function differs from `_hasPermissionSpecificallyOrGenerally` as it *does* take into account whether
     * there is a delay for the action associated with the permission being checked.
     *
     * The address `account` may have the permission associated with the provided action but that doesn't necessarily
     * mean that it may perform that action. If there is no delay associated with this action, `account` may perform the
     * action directly. If there is a delay, then `account` is instead able to schedule that action to be performed
     * at a later date.
     *
     * This function only returns true only in the first case (except for actions performed by the authorizer timelock).
     */
    function _canPerformSpecificallyOrGenerally(
        bytes32 baseActionId,
        address account,
        address where,
        bytes32 specifier
    ) internal view returns (bool) {
        // If there is a delay defined for the specific action ID, then the sender must be the authorizer (scheduled
        // execution)
        bytes32 specificActionId = getExtendedActionId(baseActionId, specifier);
        if (_delaysPerActionId[specificActionId] > 0) {
            return account == address(_executor);
        }

        // If there is no delay, we check if the account has that permission
        if (hasPermission(specificActionId, account, where)) {
            return true;
        }

        // If the account doesn't have the explicit permission, we repeat for the general permission
        bytes32 generalActionId = getExtendedActionId(baseActionId, GENERAL_PERMISSION_SPECIFIER);
        return canPerform(generalActionId, account, where);
    }

    /**
     * @dev Sets the root address to `root`.
     */
    function _setRoot(address root) internal {
        _root = root;
        emit RootSet(root);
    }

    /**
     * @dev Sets the pending root address to `pendingRoot`.
     */
    function _setPendingRoot(address pendingRoot) internal {
        _pendingRoot = pendingRoot;
        emit PendingRootSet(pendingRoot);
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
