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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAuthorizerAdaptorEntrypoint.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/IAuthentication.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IAuthorizer.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "./TimelockExecutionHelper.sol";

/**
 * @title Timelock Authorizer
 * @author Balancer Labs
 * @dev Authorizer with timelocks (delays).
 *
 * Users are allowed to perform actions if they have the permission to do so.
 *
 * This Authorizer implementation allows defining a delay per action identifier. If a delay is set for an action, users
 * are instead allowed to schedule an execution that will be run in the future by the Authorizer instead of executing it
 * directly themselves.
 *
 * Glossary:
 * - Action: Operation that can be performed to a target contract. These are identified by a unique bytes32 `actionId`
 *   defined by each target contract following `IAuthentication.getActionId`.
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
 *
 * Note that the TimelockAuthorizer doesn't make use of reentrancy guards on the majority of external functions.
 * The only function which makes an external non-view call (and so could initate a reentrancy attack) is `execute`
 * which executes a scheduled execution and so this is the only protected function.
 * In fact a number of the TimelockAuthorizer's functions may only be called through a scheduled execution so reentrancy
 * is necessary in order to be able to call these.
 */
contract TimelockAuthorizer is IAuthorizer, IAuthentication, ReentrancyGuard {
    using Address for address;

    /**
     * @notice An action specifier which grants a general permission to perform all variants of the base action.
     */
    bytes32
        public constant GENERAL_PERMISSION_SPECIFIER = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    // solhint-disable-previous-line max-line-length

    /**
     * @notice A sentinel value for `where` that will match any address.
     */
    address public constant EVERYWHERE = address(-1);

    /**
     * @notice A constant value for `scheduledExecutionId` that will match any execution Id.
     * Cancelers assigned to this Id will be able to cancel *any* scheduled action,
     * which is very useful for e.g. emergency response dedicated teams that analyze these.
     */
    uint256 public constant GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID = type(uint256).max;

    // We institute a maximum delay to ensure that actions cannot be accidentally/maliciously disabled through setting
    // an arbitrarily long delay.
    uint256 public constant MAX_DELAY = 2 * (365 days);

    // We need a minimum delay period to ensure that all delay changes may be properly scrutinised.
    uint256 public constant MINIMUM_CHANGE_DELAY_EXECUTION_DELAY = 5 days;

    struct ScheduledExecution {
        address where;
        bytes data;
        bool executed;
        bool cancelled;
        bool protected;
        uint256 executableAt;
    }

    // solhint-disable var-name-mixedcase
    bytes32 public immutable REVOKE_ACTION_ID;
    bytes32 public immutable SCHEDULE_DELAY_ACTION_ID;

    // These action ids do not need to be used by external actors as the action ids above do.
    // Instead they're saved just for gas savings so we can keep them private.
    bytes32 private immutable _GENERAL_REVOKE_ACTION_ID;

    TimelockExecutionHelper private immutable _executionHelper;
    IAuthentication private immutable _vault;
    IAuthorizerAdaptorEntrypoint private immutable _authorizerAdaptorEntrypoint;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;
    uint256 private immutable _rootTransferDelay;

    // Authorizer permissions
    address private _root;
    address private _pendingRoot;

    // scheduled execution id => account => is executor
    mapping(uint256 => mapping(address => bool)) private _isExecutor;

    // action id => account => where => is granter
    mapping(bytes32 => mapping(address => mapping(address => bool))) private _isGranter;
    // action id => delay
    mapping(bytes32 => uint256) private _grantDelays;
    // account => where => is revoker
    mapping(address => mapping(address => bool)) private _isRevoker;
    // action id => delay
    mapping(bytes32 => uint256) private _revokeDelays;
    // scheduled execution id => account => is canceler
    mapping(uint256 => mapping(address => bool)) private _isCanceler;

    // External permissions
    mapping(bytes32 => bool) private _isPermissionGranted;
    mapping(bytes32 => uint256) private _delaysPerActionId;

    ScheduledExecution[] private _scheduledExecutions;

    /**
     * @notice Emitted when a revoke permission is scheduled.
     */
    event RevokePermissionScheduled(bytes32 indexed actionId, uint256 indexed scheduledExecutionId);

    /**
     * @notice Emitted when a grant permission is scheduled.
     */
    event GrantPermissionScheduled(bytes32 indexed actionId, uint256 indexed scheduledExecutionId);

    /**
     * @notice Emitted when a revoke delay change is scheduled.
     */
    event RevokeDelayChangeScheduled(bytes32 indexed actionId, uint256 indexed scheduledExecutionId);

    /**
     * @notice Emitted when a grant delay change is scheduled.
     */
    event GrantDelayChangeScheduled(bytes32 indexed actionId, uint256 indexed scheduledExecutionId);

    /**
     * @notice Emitted when a delay change is scheduled.
     */
    event DelayChangeScheduled(bytes32 indexed actionId, uint256 indexed scheduledExecutionId);

    /**
     * @notice Emitted when a root change is scheduled.
     */
    event RootChangeScheduled(bytes32 indexed actionId, uint256 indexed scheduledExecutionId);

    /**
     * @notice Emitted when a new execution `scheduledExecutionId` is scheduled.
     */
    event ExecutionScheduled(bytes32 indexed actionId, uint256 indexed scheduledExecutionId);

    /**
     * @notice Emitted when an executor is added for a scheduled execution `scheduledExecutionId`.
     */
    event ExecutorAdded(uint256 indexed scheduledExecutionId, address indexed executor);

    /**
     * @notice Emitted when an account is added as a granter for `actionId` in `where`.
     */
    event GranterAdded(bytes32 indexed actionId, address indexed account, address indexed where);

    /**
     * @notice Emitted when an account is removed as a granter `actionId` in `where`.
     */
    event GranterRemoved(bytes32 indexed actionId, address indexed account, address indexed where);

    /**
     * @notice Emitted when `account` is added as a revoker in `where`.
     */
    event RevokerAdded(address indexed account, address indexed where);

    /**
     * @notice Emitted when an account is removed as a revoker in `where`.
     */
    event RevokerRemoved(address indexed account, address indexed where);

    /**
     * @notice Emitted when a canceler is added for a scheduled execution `scheduledExecutionId`.
     */
    event CancelerAdded(uint256 indexed scheduledExecutionId, address indexed canceler);

    /**
     * @notice Emitted when a canceler is removed for a scheduled execution `scheduledExecutionId`.
     */
    event CancelerRemoved(uint256 indexed scheduledExecutionId, address indexed canceler);

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
     * @notice Emitted when a new `delay` is set in order to grant permission to execute action `actionId`.
     */
    event GrantDelaySet(bytes32 indexed actionId, uint256 delay);

    /**
     * @notice Emitted when a new `delay` is set in order to revoke permission to execute action `actionId`.
     */
    event RevokeDelaySet(bytes32 indexed actionId, uint256 delay);

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

    /**
     * @dev Prevents a TimelockAuthorizer function from being called directly, making it only possible to call it by
     * scheduling a delayed execution.
     *
     * Each function that has this modifier applied to it should have an associated function that performs proper
     * permission validation and then schedules a call.
     */
    modifier onlyScheduled() {
        // Checking that we're being called by the TimelockExecutionHelper is a sufficient check, given that:
        //
        //  1) The TimelockExecutionHelper can only make external calls (and cause this modifier to not revert) if
        //     called by the TimelockAuthorizer.
        //
        //  2) The TimelockAuthorizer only makes external non-view calls in a single place: when the `execute` function
        //    is called by an executor. This is the only possible time it could call the TimelockExecutionHelper.
        //
        //  3) `execute` can only be called after scheduling a delayed execution.
        //
        //  4) Scheduled delayed executions either target the TimelockAuthorizer directly (such as in
        //    `scheduleRootChange` or `scheduleDelayChange`), in which case this modifier will not revert (as intended,
        //    given those functions check proper permissions), or explictly forbid targeting the TimelockAuthorizer
        //    (in the `schedule` function), making it impossible for the TimelockExecutionHelper to call into it.
        require(msg.sender == address(_executionHelper), "CAN_ONLY_BE_SCHEDULED");
        _;
    }

    constructor(
        address initialRoot,
        address nextRoot,
        IAuthorizerAdaptorEntrypoint authorizerAdaptorEntrypoint,
        uint256 rootTransferDelay
    ) {
        _setRoot(initialRoot);
        // By setting `nextRoot` as the pending root, it can immediately call `claimRoot` and replace `initialRoot`,
        // skipping the root transfer delay for the very first root transfer. This is very useful in schemes where a
        // migrator contract is the initial root and performs some initial setup, and then needs to transfer this
        // permission to some other account.
        _setPendingRoot(nextRoot);

        _vault = authorizerAdaptorEntrypoint.getVault();
        _authorizerAdaptor = authorizerAdaptorEntrypoint.getAuthorizerAdaptor();
        _authorizerAdaptorEntrypoint = authorizerAdaptorEntrypoint;
        _executionHelper = new TimelockExecutionHelper();
        _rootTransferDelay = rootTransferDelay;

        bytes32 revokeActionId = getActionId(TimelockAuthorizer.revokePermissions.selector);
        bytes32 generalRevokeActionId = getExtendedActionId(revokeActionId, GENERAL_PERMISSION_SPECIFIER);

        // These don't technically need to be granted, as `initialRoot` is the new root, and can grant these permissions
        // directly to itself. But granting here improves ergonomics, especially in testing, as `initialRoot` is now
        // ready to grant any permission.
        _grantPermission(generalRevokeActionId, initialRoot, EVERYWHERE);

        REVOKE_ACTION_ID = revokeActionId;
        SCHEDULE_DELAY_ACTION_ID = getActionId(TimelockAuthorizer.scheduleDelayChange.selector);
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
     * @notice Returns the TimelockExecutionHelper address.
     */
    function getTimelockExecutionHelper() external view returns (address) {
        return address(_executionHelper);
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
     * @notice Returns the action ID for revoking a permission for action `actionId`.
     */
    function getRevokePermissionActionId(bytes32 actionId) public view returns (bytes32) {
        return getExtendedActionId(REVOKE_ACTION_ID, actionId);
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
     * @notice Returns the execution delay for granting permission for action `actionId`.
     */
    function getActionIdGrantDelay(bytes32 actionId) external view returns (uint256) {
        return _grantDelays[actionId];
    }

    /**
     * @notice Returns the execution delay for revoking permission for action `actionId`.
     */
    function getActionIdRevokeDelay(bytes32 actionId) external view returns (uint256) {
        return _revokeDelays[actionId];
    }

    /**
     * @notice Returns the permission ID for action `actionId`, account `account` and target `where`.
     */
    function getPermissionId(
        bytes32 actionId,
        address account,
        address where
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(actionId, account, where));
    }

    /**
     * @notice Returns true if `account` has the permission defined by action `actionId` and target `where`.
     * @dev This function is specific for the strict permission defined by the tuple `(actionId, where)`: `account` may
     * instead hold the global permission for the action `actionId`, also granting them permission on `where`, but this
     * function would return false regardless.
     *
     * For this reason, it's recommended to use `hasPermission` if checking whether `account` is allowed to perform
     * a given action.
     */
    function isPermissionGrantedOnTarget(
        bytes32 actionId,
        address account,
        address where
    ) external view returns (bool) {
        return _isPermissionGranted[getPermissionId(actionId, account, where)];
    }

    /**
     * @notice Returns true if `account` has permission over the action `actionId` in target `where`.
     */
    function hasPermission(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return
            _isPermissionGranted[getPermissionId(actionId, account, where)] ||
            _isPermissionGranted[getPermissionId(actionId, account, EVERYWHERE)];
    }

    /**
     * @notice Returns true if `account` is allowed to grant permissions for action `actionId` in target `where`.
     */
    function isGranter(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return _isGranter[actionId][account][where] || _isGranter[actionId][account][EVERYWHERE] || isRoot(account);
    }

    /**
     * @notice Returns true if `account` is allowed to revoke permissions in target `where` for all actions.
     */
    function isRevoker(address account, address where) public view returns (bool) {
        return _isRevoker[account][where] || _isRevoker[account][EVERYWHERE] || isRoot(account);
    }

    /**
     * @notice Returns true if `account` can perform action `actionId` in target `where`. This will return false for
     * actions that have a delay associated with them, even if `account` has permission over the action, since `account`
     * cannot perform the action directly - it must instead schedule a future execution of it via `schedule`.
     *
     * @dev All authentications that require the AuthorizerAdaptor must originate from the AuthorizerAdaptorEntrypoint:
     * requests coming directly from the AuthorizerAdaptor will be rejected.
     */
    function canPerform(
        bytes32 actionId,
        address account,
        address where
    ) public view override returns (bool) {
        if (msg.sender == address(_authorizerAdaptor)) {
            // The situation where the caller is the `AuthorizerAdaptor` is a special case, as due to a bug it can be
            // tricked into passing an incorrect `actionId` value, potentially resulting in escalation of privileges.
            //
            // To remedy this we force all calls to the `AuthorizerAdaptor` to be made through a singleton entrypoint
            // contract, called the `AuthorizerAdaptorEntrypoint`. This contract correctly checks whether `account` can
            // perform `actionId` on `where`, and then forwards the call onto the `AuthorizerAdaptor` to execute.
            //
            // The authorizer then rejects calls to the `AuthorizerAdaptor` which aren't made through the entrypoint,
            // and approves all calls made through it (since the entrypoint will have already performed any necessary
            // permission checks).
            return account == address(_authorizerAdaptorEntrypoint);
        }

        // Actions with no delay can only be performed by accounts that have the associated permission.
        // However, actions with a non-zero delay cannot be performed by permissioned accounts: they can only be made by
        // the TimelockAuthorizerExecutionHelper, which works alongisde the TimelockAuthorizer itself to ensure that
        // executions have been properly scheduled in advance by an authorized party via the `schedule` function.
        return
            _delaysPerActionId[actionId] == 0
                ? hasPermission(actionId, account, where)
                : account == address(_executionHelper);
    }

    /**
     * @notice Returns true if `account` can grant permissions for action `actionId` in target `where`.
     */
    function canGrant(
        bytes32 actionId,
        address account,
        address where
    ) public view returns (bool) {
        return _grantDelays[actionId] > 0 ? account == address(_executionHelper) : isGranter(actionId, account, where);
    }

    /**
     * @notice Returns the scheduled execution `scheduledExecutionId`.
     */
    function getScheduledExecution(uint256 scheduledExecutionId) external view returns (ScheduledExecution memory) {
        return _scheduledExecutions[scheduledExecutionId];
    }

    /**
     * @notice Returns true if `account` is an executor for `scheduledExecutionId`.
     */
    function isExecutor(uint256 scheduledExecutionId, address account) public view returns (bool) {
        return _isExecutor[scheduledExecutionId][account];
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
    function scheduleRootChange(address newRoot, address[] memory executors) external returns (uint256) {
        require(isRoot(msg.sender), "SENDER_IS_NOT_ROOT");
        bytes32 actionId = getActionId(this.setPendingRoot.selector);
        bytes memory data = abi.encodeWithSelector(this.setPendingRoot.selector, newRoot);

        // Since this can only be called by root, which is always a canceler for all scheduled executions, we don't
        // bother creating any new cancelers.
        uint256 scheduledExecutionId = _scheduleWithDelay(address(this), data, getRootTransferDelay(), executors);
        emit RootChangeScheduled(actionId, scheduledExecutionId);
        return scheduledExecutionId;
    }

    /**
     * @notice Sets the pending root address to `pendingRoot`.
     * @dev This function can never be called directly - it is only ever called as part of a scheduled execution by
     * the TimelockExecutionHelper after after calling `scheduleRootChange`.
     *
     * Once set as the pending root, `pendingRoot` may then call `claimRoot` to become the new root.
     */
    function setPendingRoot(address pendingRoot) external onlyScheduled {
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
        require(msg.sender == pendingRoot, "SENDER_IS_NOT_PENDING_ROOT");

        // Grant powers to new root to grant or revoke any permission over any contract.
        _grantPermission(_GENERAL_REVOKE_ACTION_ID, pendingRoot, EVERYWHERE);

        // Revoke these powers from the outgoing root.
        _revokePermission(_GENERAL_REVOKE_ACTION_ID, currentRoot, EVERYWHERE);

        // Complete the root transfer and reset the pending root.
        _setRoot(pendingRoot);
        _setPendingRoot(address(0));
    }

    /**
     * @notice Sets a new delay `delay` for action `actionId`.
     * @dev This function can never be called directly - it is only ever called as part of a scheduled execution by
     * the TimelockExecutionHelper after after calling `scheduleDelayChange`.
     */
    function setDelay(bytes32 actionId, uint256 delay) external onlyScheduled {
        // If changing the `setAuthorizer` delay itself, then we don't need to compare it to its current value for
        // validity.
        if (actionId != _vault.getActionId(IVault.setAuthorizer.selector)) {
            require(_isDelayShorterThanSetAuthorizer(delay), "DELAY_EXCEEDS_SET_AUTHORIZER");
        }

        _delaysPerActionId[actionId] = delay;
        emit ActionDelaySet(actionId, delay);
    }

    /**
     * @notice Sets a new grant action delay `delay` for action `actionId`
     * @dev This function can never be called directly - it is only ever called as part of a scheduled execution by
     * the TimelockExecutor after after calling `scheduleGrantDelayChange`.
     * Delay has to be shorter than the Authorizer delay.
     */
    function setGrantDelay(bytes32 actionId, uint256 delay) external onlyScheduled {
        require(_isDelayShorterThanSetAuthorizer(delay), "DELAY_EXCEEDS_SET_AUTHORIZER");

        _grantDelays[actionId] = delay;
        emit GrantDelaySet(actionId, delay);
    }

    /**
     * @notice Sets a new revoke action delay `delay` for action `actionId`
     * @dev This function can never be called directly - it is only ever called as part of a scheduled execution by
     * the TimelockExecutor after after calling `scheduleRevokeDelayChange`.
     * Delay has to be shorter than the Authorizer delay.
     */
    function setRevokeDelay(bytes32 actionId, uint256 delay) external onlyScheduled {
        require(_isDelayShorterThanSetAuthorizer(delay), "DELAY_EXCEEDS_SET_AUTHORIZER");

        _revokeDelays[actionId] = delay;
        emit RevokeDelaySet(actionId, delay);
    }

    function _isDelayShorterThanSetAuthorizer(uint256 delay) private view returns (bool) {
        // No delay can be greater than the current delay for changing the Authorizer itself (`IVault.setAuthorizer`).
        // Otherwise, it'd be possible to execute the action with a shorter delay by simply replacing the
        // TimelockAuthorizer with a different contract that didn't enforce these delays.
        // Note that it is still possible for an action to end up with a delay longer than `setAuthorizer` if e.g.
        // `setAuthorizer`'s delay was to ever be decreased, but this is not expected to happen. The following check is
        // therefore simply a way to try to prevent user error, but is not infallible.

        bytes32 setAuthorizerActionId = _vault.getActionId(IVault.setAuthorizer.selector);
        return delay <= _delaysPerActionId[setAuthorizerActionId];
    }

    /**
     * @notice Schedules an execution to set the delay for `actionId`' to `newDelay`.
     */
    function scheduleDelayChange(
        bytes32 actionId,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256) {
        require(isRoot(msg.sender), "SENDER_IS_NOT_ROOT");
        require(newDelay <= MAX_DELAY, "DELAY_TOO_LARGE");

        uint256 executionDelay = _getDelayChangeExecutionDelay(_delaysPerActionId[actionId], newDelay);

        bytes32 scheduleDelayActionId = getScheduleDelayActionId(actionId);
        bytes memory data = abi.encodeWithSelector(this.setDelay.selector, actionId, newDelay);

        // Since this can only be called by root, which is always a canceler for all scheduled executions, we don't
        // bother creating any new cancelers.
        uint256 scheduledExecutionId = _scheduleWithDelay(address(this), data, executionDelay, executors);
        emit DelayChangeScheduled(scheduleDelayActionId, scheduledExecutionId);
        return scheduledExecutionId;
    }

    /**
     * @notice Schedules an execution to set the delay for granting permission over `actionId` to `newDelay`.
     */
    function scheduleGrantDelayChange(
        bytes32 actionId,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256) {
        require(isRoot(msg.sender), "SENDER_IS_NOT_ROOT");
        require(newDelay <= MAX_DELAY, "DELAY_TOO_LARGE");

        uint256 executionDelay = _getDelayChangeExecutionDelay(_grantDelays[actionId], newDelay);

        bytes memory data = abi.encodeWithSelector(this.setGrantDelay.selector, actionId, newDelay);

        // Since this can only be called by root, which is always a canceler for all scheduled executions, we don't
        // bother creating any new cancelers.
        uint256 scheduledExecutionId = _scheduleWithDelay(address(this), data, executionDelay, executors);
        emit GrantDelayChangeScheduled(actionId, scheduledExecutionId);
        return scheduledExecutionId;
    }

    /**
     * @notice Schedules an execution to set the delay for revoking permission over `actionId` to `newDelay`.
     */
    function scheduleRevokeDelayChange(
        bytes32 actionId,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256) {
        require(isRoot(msg.sender), "SENDER_IS_NOT_ROOT");
        require(newDelay <= MAX_DELAY, "DELAY_TOO_LARGE");

        uint256 executionDelay = _getDelayChangeExecutionDelay(_revokeDelays[actionId], newDelay);

        bytes memory data = abi.encodeWithSelector(this.setRevokeDelay.selector, actionId, newDelay);

        // Since this can only be called by root, which is always a canceler for all scheduled executions, we don't
        // bother creating any new cancelers.
        uint256 scheduledExecutionId = _scheduleWithDelay(address(this), data, executionDelay, executors);
        emit RevokeDelayChangeScheduled(actionId, scheduledExecutionId);
        return scheduledExecutionId;
    }

    function _getDelayChangeExecutionDelay(uint256 currentDelay, uint256 newDelay) private pure returns (uint256) {
        // The delay change is scheduled so that it's never possible to execute an action in a shorter time than the
        // current delay.
        //
        // If we're reducing the action's delay then we must first wait for the difference between the two delays.
        // This means that if we immediately schedule the action for execution once the delay is reduced, then
        // these two delays combined will result in the original delay.
        // For example, if an action's delay is 20 days and we wish to reduce it to 5 days, we need to wait 15 days
        // before the new shorter delay is effective, to make it impossible to execute the action before the full
        // original 20-day delay period has elapsed.
        //
        // If we're increasing the delay on an action, we could in principle execute this change immediately, since the
        // larger delay would fulfill the original constraint imposed by the first delay.
        // For example, if we wish to increase the delay of an action from 5 days to 20 days, there is no need to wait
        // as it would not be possible to execute the action with a delay shorter than the initial 5 days at any point.
        //
        // However, not requiring a delay to increase an action's delay creates an issue: it would be possible to
        // effectively disable actions by setting huge delays (e.g. 2 years) for them. Because of this, all delay
        // changes are subject to a minimum execution delay, to allow for proper scrutiny of these potentially
        // dangerous actions.

        return
            newDelay < currentDelay
                ? Math.max(currentDelay - newDelay, MINIMUM_CHANGE_DELAY_EXECUTION_DELAY)
                : MINIMUM_CHANGE_DELAY_EXECUTION_DELAY;
    }

    /**
     * @notice Schedules an arbitrary execution of `data` in target `where`. Returns a scheduledExecutionId that can be
     * used to call `execute`, `cancel`, and associated getters such as `getScheduledExecution`.
     *
     * If `executors` is an empty array, then any account in the network will be able to initiate the scheduled
     * execution. If not, only accounts in the `executors` array will be able to call `execute`. It is not possible to
     * change this after scheduling: the list of executors is immutable, and cannot be changed by any account (including
     * root).
     *
     * The caller of the `schedule` function is automatically made a canceler for the scheduled execution, meaning they
     * can call the `cancel` function for it. Other accounts, such as root, may also have or be granted permission to
     * cancel any scheduled execution.
     *
     * This is the only way to execute actions in external contracts that have a delay associated with them. Calling
     * said functions directly will cause `canPerform` to return false, even if the caller has permission. An account
     * that has permission over an action with a delay cannot call it directly, and must instead schedule a delayed
     * execution by calling this function.
     */
    function schedule(
        address where,
        bytes memory data,
        address[] memory executors
    ) external returns (uint256) {
        // Allowing scheduling arbitrary calls into the TimelockAuthorizer is dangerous.
        //
        // It is expected that only the `root` account can initiate a root transfer as this condition is enforced
        // by the `scheduleRootChange` function which is the expected method of scheduling a call to `setPendingRoot`.
        // If a call to `setPendingRoot` could be scheduled using this function as well as `scheduleRootChange` then
        // accounts other than `root` could initiate a root transfer (provided they had the necessary permission).
        // Similarly, `setDelay` can only be called if scheduled via `scheduleDelayChange`.
        //
        // For this reason we disallow this function from scheduling calls to functions on the Authorizer to ensure that
        // these actions can only be scheduled through specialised functions.
        require(where != address(this), "CANNOT_SCHEDULE_AUTHORIZER_ACTIONS");

        // We also disallow the TimelockExecutionHelper from attempting to call into itself. Otherwise the above
        // protection could be bypassed by wrapping a call to `setPendingRoot` inside of a call, causing the
        // TimelockExecutionHelper to reenter itself, essentially hiding the fact that `where == address(this)` inside
        // `data`.
        //
        // Note: The TimelockExecutionHelper only accepts calls from the TimelockAuthorizer (i.e. not from itself) so
        // this scenario should be impossible: but this check is cheap so we enforce it here as well anyway.
        require(where != address(_executionHelper), "ATTEMPTING_EXECUTION_HELPER_REENTRANCY");

        bytes32 actionId = IAuthentication(where).getActionId(_decodeSelector(data));
        require(hasPermission(actionId, msg.sender, where), "SENDER_DOES_NOT_HAVE_PERMISSION");

        uint256 delay = _delaysPerActionId[actionId];
        require(delay > 0, "CANNOT_SCHEDULE_ACTION");
        uint256 scheduledExecutionId = _scheduleWithDelay(where, data, delay, executors);

        emit ExecutionScheduled(actionId, scheduledExecutionId);

        // Accounts that schedule actions are automatically made cancelers for them, so that they can manage their
        // action. We check that they are not already a canceler since e.g. root may schedule actions (and root is
        // always a global canceler).
        if (!isCanceler(scheduledExecutionId, msg.sender)) {
            _addCanceler(scheduledExecutionId, msg.sender);
        }
        return scheduledExecutionId;
    }

    /**
     * @notice Executes a scheduled action `scheduledExecutionId`. This is used to execute all scheduled executions,
     * not only those that originate from `schedule`, but also internal TimelockAuthorizer functions such as
     * `scheduleRootChange` or `scheduleDelayChange`.
     *
     * If any executors were set up when scheduling, `execute` can only be called by them. If none were set, the
     * scheduled execution is said to be 'unprotected', and can be executed by anyone.
     *
     * Once executed, a scheduled execution cannot be executed again. It also cannot be executed if canceled.
     *
     * We mark this function as `nonReentrant` out of an abundance of caution, as in theory this and the Authorizer
     * should be resilient to reentrant executions. The non-reentrancy check means that it is not possible to execute a
     * scheduled action during the execution of another scheduled action - an unlikely and convoluted scenario that we
     * explicitly forbid.
     *
     * Note that while `execute` is nonReentrant, other functions are not - indeed, we rely on reentrancy to e.g. call
     * `setPendingRoot` or `setDelay`.
     */
    function execute(uint256 scheduledExecutionId) external nonReentrant returns (bytes memory result) {
        require(scheduledExecutionId < _scheduledExecutions.length, "ACTION_DOES_NOT_EXIST");
        ScheduledExecution storage scheduledExecution = _scheduledExecutions[scheduledExecutionId];
        require(!scheduledExecution.executed, "ACTION_ALREADY_EXECUTED");
        require(!scheduledExecution.cancelled, "ACTION_ALREADY_CANCELLED");

        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp >= scheduledExecution.executableAt, "ACTION_NOT_YET_EXECUTABLE");

        if (scheduledExecution.protected) {
            // Protected scheduled executions can only be executed by a set of accounts designated by the original
            // scheduler.
            require(isExecutor(scheduledExecutionId, msg.sender), "SENDER_IS_NOT_EXECUTION_HELPER");
        }

        scheduledExecution.executed = true;

        // Note that this is the only place in the entire contract we perform a non-view call to an external contract,
        // i.e. this is the only context in which this contract can be re-entered, and by this point we've already
        // completed all state transitions.
        // This results in the scheduled execution being marked as 'executed' during its execution, but that should not
        // be an issue.
        result = _executionHelper.execute(scheduledExecution.where, scheduledExecution.data);
        emit ExecutionExecuted(scheduledExecutionId);
    }

    /**
     * @notice Cancels a scheduled action `scheduledExecutionId`, which prevents execution via `execute`. Canceling is
     * irreversible. Scheduled executions that have already been executed cannot be canceled. This is the only way to
     * prevent a scheduled execution from being executed (assuming there are willing executors).
     *
     * The caller must be a canceler, a permission which is managed by the `addCanceler` and `removeCanceler` functions.
     * Note that root is always a canceler for all scheduled executions.
     */
    function cancel(uint256 scheduledExecutionId) external {
        require(scheduledExecutionId < _scheduledExecutions.length, "ACTION_DOES_NOT_EXIST");
        ScheduledExecution storage scheduledExecution = _scheduledExecutions[scheduledExecutionId];

        require(!scheduledExecution.executed, "ACTION_ALREADY_EXECUTED");
        require(!scheduledExecution.cancelled, "ACTION_ALREADY_CANCELLED");

        require(isCanceler(scheduledExecutionId, msg.sender), "SENDER_IS_NOT_CANCELER");

        scheduledExecution.cancelled = true;
        emit ExecutionCancelled(scheduledExecutionId);
    }

    function isCanceler(uint256 scheduledExecutionId, address account) public view returns (bool) {
        return
            _isCanceler[scheduledExecutionId][account] ||
            _isCanceler[GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID][account] ||
            isRoot(account);
    }

    function addCanceler(uint256 scheduledExecutionId, address account) external {
        require(isRoot(msg.sender), "SENDER_IS_NOT_ROOT");
        _addCanceler(scheduledExecutionId, account);
    }

    function removeCanceler(uint256 scheduledExecutionId, address account) external {
        require(isRoot(msg.sender), "SENDER_IS_NOT_ROOT");

        // The root account is always a canceler, and this cannot be revoked.
        require(!isRoot(account), "CANNOT_REMOVE_ROOT_CANCELER");

        if (_isCanceler[GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID][account]) {
            // If an account is a global canceler, then it must explicitly lose this global privilege. This prevents
            // scenarios where an account has their canceler status revoked over a specific scheduled execution id, but
            // they can still cancel it because they have global permission.
            // There's an edge case in which an account could have both specific and global cancel privilege, and still
            // be able to cancel some scheduled executions after losing global privilege. This is considered an unlikely
            // scenario, and would require manual removal of the specific canceler privileges even after removal
            // of the global one.
            require(scheduledExecutionId == GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID, "ACCOUNT_IS_GLOBAL_CANCELER");
        } else {
            // Alternatively, they must currently be a canceler in order to be revoked.
            require(_isCanceler[scheduledExecutionId][account], "ACCOUNT_IS_NOT_CANCELER");
        }

        _isCanceler[scheduledExecutionId][account] = false;
        emit CancelerRemoved(scheduledExecutionId, account);
    }

    function _addCanceler(uint256 scheduledExecutionId, address account) private {
        require(!isCanceler(scheduledExecutionId, account), "ACCOUNT_IS_ALREADY_CANCELER");

        _isCanceler[scheduledExecutionId][account] = true;
        emit CancelerAdded(scheduledExecutionId, account);
    }

    /**
     * @notice Grants granter status to `account` for action `actionId` in target `where`.
     * @dev Only the root can add granters.
     *
     * Note that there are no delays associated with adding or removing granters. This is based on the assumption that
     * any action which a malicious user could exploit to damage the protocol will have a sufficiently long delay
     * associated with either granting permission for or exercising that permission such that the root will be able to
     * reestablish control and cancel either the granting or associated action before it can be executed, and then
     * remove the granter.
     *
     * A malicious granter may also attempt to use their granter status to grant permission to multiple accounts, but
     * they cannot add new granters. Therefore, the danger posed by a malicious granter is limited and self-
     * contained. Root can mitigate the situation simply and completely by revoking first their granter status,
     * and then any permissions granted by that account, knowing there cannot be any more.
     */
    function addGranter(
        bytes32 actionId,
        address account,
        address where
    ) external {
        require(isRoot(msg.sender), "SENDER_IS_NOT_ROOT");

        require(!isGranter(actionId, account, where), "ACCOUNT_IS_ALREADY_GRANTER");
        // Note that it is possible for `account` to be a granter for the same `actionId` in some specific `where`, and
        // then be granted permission over `EVERYWHERE`, resulting in 'duplicate' permissions. This is not an issue per
        // se, but removing this granter status will require undoing these actions in inverse order.
        // To avoid these issues, it is recommended to revoke any prior granter status over specific contracts before
        // making an account a global granter.

        _isGranter[actionId][account][where] = true;
        emit GranterAdded(actionId, account, where);
    }

    /**
     * @notice Revokes granter status from `account` for action `actionId` in target `where`.
     * @dev Only the root can remove granters.
     *
     * Note that there are no delays associated with removing granters. The only instance in which one might be useful
     * is if we had contracts that were granters, and this was depended upon for operation of the system. This however
     * doesn't seem like it will ever be required - granters are typically subDAOs.
     *
     * After removing a malicious granter, care should be taken to review their actions and remove any permissions
     * granted by them, or cancel scheduled grants. This should be done *after* removing the granter, at which point
     * they won't be able to create any more of these.
     */
    function removeGranter(
        bytes32 actionId,
        address account,
        address where
    ) external {
        require(isRoot(msg.sender), "SENDER_IS_NOT_ROOT");

        require(isGranter(actionId, account, where), "ACCOUNT_IS_NOT_GRANTER");

        require(!isRoot(account), "CANNOT_REMOVE_ROOT_GRANTER");

        // On top of requiring that the account is currently a granter, we prevent attempts to revoke permission over a
        // single contract from global granters. As mentioned in `addGranter`, it is possible for an account to have
        // both global and specific permissions over a given contract: in this case, the global permission must be
        // removed before the specific ones can be addressed.
        if (_isGranter[actionId][account][EVERYWHERE]) {
            require(where == EVERYWHERE, "GRANTER_IS_GLOBAL");
        }

        _isGranter[actionId][account][where] = false;
        emit GranterRemoved(actionId, account, where);
    }

    /**
     * @notice Grants multiple permissions to a single `account`.
     * @dev This function can only be used for actions that have no grant delay. For those that do, use
     * `scheduleGrantPermission` instead.
     */
    function grantPermissions(
        bytes32[] memory actionIds,
        address account,
        address[] memory where
    ) external {
        InputHelpers.ensureInputLengthMatch(actionIds.length, where.length);
        for (uint256 i = 0; i < actionIds.length; i++) {
            if (_grantDelays[actionIds[i]] == 0) {
                require(isGranter(actionIds[i], msg.sender, where[i]), "SENDER_IS_NOT_GRANTER");
            } else {
                // Some actions may have delays associated with granting them - these permissions cannot be granted
                // directly, even if the caller is a granter, and must instead be scheduled for future execution via
                // `scheduleGrantPermission`.
                require(msg.sender == address(_executionHelper), "GRANT_MUST_BE_SCHEDULED");
            }

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
    ) external returns (uint256) {
        require(isGranter(actionId, msg.sender, where), "SENDER_IS_NOT_GRANTER");

        uint256 delay = _grantDelays[actionId];
        require(delay > 0, "ACTION_HAS_NO_GRANT_DELAY");

        bytes memory data = abi.encodeWithSelector(this.grantPermissions.selector, _ar(actionId), account, _ar(where));

        // TODO: fix actionId for event (maybe overhaul _scheduleWithDelay?)
        uint256 scheduledExecutionId = _scheduleWithDelay(address(this), data, delay, executors);
        emit GrantPermissionScheduled(actionId, scheduledExecutionId);
        // Granters that schedule actions are automatically made cancelers for them, so that they can manage their
        // action. We check that they are not already a canceler since e.g. root may schedule grants (and root is
        // always a global canceler).
        if (!isCanceler(scheduledExecutionId, msg.sender)) {
            _addCanceler(scheduledExecutionId, msg.sender);
        }
        return scheduledExecutionId;
    }

    /**
     * @notice Grants revoker status to `account` in target `where` for all actions.
     * @dev Only the root can add revokers.
     *
     * Note that there are no delays associated with adding revokers. This is based on the assumption that any
     * permissions for which revocation from key addresses would be dangerous (e.g. preventing the BalancerMinter from
     * minting BAL) have sufficiently long delays associated with revoking them that the root will be able to
     * reestablish control and cancel the revocation before the scheduled revocation can be executed.
     *
     * A malicious revoker cannot add new revokers, so root can simply revoke their status once.
     */
    function addRevoker(address account, address where) external {
        require(isRoot(msg.sender), "SENDER_IS_NOT_ROOT");

        require(!isRevoker(account, where), "ACCOUNT_IS_ALREADY_REVOKER");
        // Note that it's possible for the `account` to be a revoker in a specific `where`, and
        // later receive permission over `EVERYWHERE`, resulting in 'duplicate' permissions. While this isn't
        // necessarily an issue, removing the revoker status will require undoing the actions in reverse order.
        // To avoid these issues, it's recommended to remove any prior revoker status over specific contracts before
        // granting an account global revoker.

        _isRevoker[account][where] = true;
        emit RevokerAdded(account, where);
    }

    /**
     * @notice Removes revoker status from `account` in target `where` for all actions.
     * @dev Only the root can remove revokers.
     *
     * Note that there are no delays associated with removing revokers.  The only instance in which one might be useful
     * is if we had contracts that were revoker, and this was depended upon for operation of the system. This however
     * doesn't seem like it will ever be required - revokers are typically subDAOs.
     */
    function removeRevoker(address account, address where) external {
        require(isRoot(msg.sender), "SENDER_IS_NOT_ROOT");

        require(isRevoker(account, where), "ACCOUNT_IS_NOT_REVOKER");

        require(!isRoot(account), "CANNOT_REMOVE_ROOT_REVOKER");

        // On top of requiring that the account is currently a revoker, we prevent attempts to remove permission over a
        // single contract from global revokers. As mentioned in `addRevoker`, it is possible for an account to have
        // both global and specific permissions over a given contract: in this case, the global permission must be
        // removed before the specific ones can be addressed.
        if (_isRevoker[account][EVERYWHERE]) {
            require(where == EVERYWHERE, "REVOKER_IS_GLOBAL");
        }

        _isRevoker[account][where] = false;
        emit RevokerRemoved(account, where);
    }

    /**
     * @notice Revokes multiple permissions from a single `account`.
     * @dev This function can only be used for actions that have no revoke delay. For those that do, use
     * `scheduleRevokePermission` instead.
     */
    function revokePermissions(
        bytes32[] memory actionIds,
        address account,
        address[] memory where
    ) external {
        InputHelpers.ensureInputLengthMatch(actionIds.length, where.length);
        for (uint256 i = 0; i < actionIds.length; i++) {
            if (_revokeDelays[actionIds[i]] == 0) {
                require(isRevoker(msg.sender, where[i]), "SENDER_IS_NOT_REVOKER");
            } else {
                // Some actions may have delays associated with revoking them - these permissions cannot be revoked
                // directly, even if the caller is a revoker, and must instead be scheduled for future execution via
                // `scheduleRevokePermission`.
                require(msg.sender == address(_executionHelper), "REVOKE_MUST_BE_SCHEDULED");
            }
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
    ) external returns (uint256) {
        require(isRevoker(msg.sender, where), "SENDER_IS_NOT_REVOKER");

        uint256 delay = _revokeDelays[actionId];
        require(delay > 0, "ACTION_HAS_NO_REVOKE_DELAY");

        bytes memory data = abi.encodeWithSelector(this.revokePermissions.selector, _ar(actionId), account, _ar(where));

        uint256 scheduledExecutionId = _scheduleWithDelay(address(this), data, delay, executors);
        emit RevokePermissionScheduled(actionId, scheduledExecutionId);
        // Revokers that schedule actions are automatically made cancelers for them, so that they can manage their
        // action. We check that they are not already a canceler since e.g. root may schedule revokes (and root is
        // always a global canceler).
        if (!isCanceler(scheduledExecutionId, msg.sender)) {
            _addCanceler(scheduledExecutionId, msg.sender);
        }
        return scheduledExecutionId;
    }

    /**
     * @notice Revokes multiple permissions from the caller.
     * @dev Note that the caller can always renounce permissions, even if revoking them would typically be
     * subject to a delay.
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
        bytes32 permission = getPermissionId(actionId, account, where);
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
        bytes32 permission = getPermissionId(actionId, account, where);
        if (_isPermissionGranted[permission]) {
            _isPermissionGranted[permission] = false;
            emit PermissionRevoked(actionId, account, where);
        }
    }

    function _scheduleWithDelay(
        address where,
        bytes memory data,
        uint256 delay,
        address[] memory executors
    ) private returns (uint256 scheduledExecutionId) {
        scheduledExecutionId = _scheduledExecutions.length;

        // solhint-disable-next-line not-rely-on-time
        uint256 executableAt = block.timestamp + delay;
        bool protected = executors.length > 0;

        _scheduledExecutions.push(
            ScheduledExecution({
                where: where,
                data: data,
                executed: false,
                cancelled: false,
                protected: protected,
                executableAt: executableAt
            })
        );

        for (uint256 i = 0; i < executors.length; i++) {
            // Note that we allow for repeated executors - this is not an issue
            _isExecutor[scheduledExecutionId][executors[i]] = true;
            emit ExecutorAdded(scheduledExecutionId, executors[i]);
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
            return account == address(_executionHelper);
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
