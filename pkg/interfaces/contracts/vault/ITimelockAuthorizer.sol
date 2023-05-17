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

pragma solidity >=0.7.0 <0.9.0;
pragma experimental ABIEncoderV2;

/**
 * @title Timelock Authorizer
 * @author Balancer Labs
 * @dev Authorizer with timelocks (delays).
 *
 * Users are allowed to perform actions if they have the permission to do so.
 *
 * This Authorizer implementation allows defining delays per action identifier. If a delay is set for an action, users
 * are not allowed to execute it directly themselves. Instead, they schedule an execution that the Authorizer will
 * run in the future.
 *
 * Glossary:
 * - Action: Operation that can be performed on a target contract. These are identified by a unique bytes32 `actionId`
 *   defined by each target contract following `IAuthentication.getActionId`.
 * - Scheduled execution: The Authorizer can define a delay for an `actionId` to require that a specific
 *   time window must pass before it can be executed. When a delay is set for an `actionId`, executions
 *   must be scheduled. These executions are identified by an unsigned integer called `scheduledExecutionId`.
 * - Permission: Accounts have or don't have permission to perform an action identified by its `actionId` on a specific
 *   contract `where`. Note that if the action has a delay, then accounts with permission cannot perform the action
 *   directly, but are instead allowed to schedule future executions for them.
 *
 * Note that the TimelockAuthorizer doesn't use reentrancy guard on its external functions.
 * The only function which makes an external non-view call (and so could initate a reentrancy attack) is `execute`
 * which executes a scheduled execution, protected by the Checks-Effects-Interactions pattern.
 * In fact a number of the TimelockAuthorizer's functions may only be called through a scheduled execution so reentrancy
 * is necessary in order to be able to call these.
 */
interface ITimelockAuthorizer {
    struct ScheduledExecution {
        address where;
        bytes data;
        bool executed;
        bool canceled;
        bool protected;
        uint256 executableAt;
        address scheduledBy;
        uint256 scheduledAt;
        address executedBy;
        uint256 executedAt;
        address canceledBy;
        uint256 canceledAt;
    }

    /**
     * @notice Emitted when a root change is scheduled.
     */
    event RootChangeScheduled(address indexed newRoot, uint256 indexed scheduledExecutionId);

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
     * @notice Emitted when an execution `scheduledExecutionId` is canceled.
     */
    event ExecutionCanceled(uint256 indexed scheduledExecutionId);

    /**
     * @notice Emitted when a new `root` is set.
     */
    event RootSet(address indexed root);

    /**
     * @notice Emitted when a new `pendingRoot` is set. The new account must claim ownership for it to take effect.
     */
    event PendingRootSet(address indexed pendingRoot);

    /**
     * @notice Emitted when a revoke permission is scheduled.
     */
    event RevokePermissionScheduled(
        bytes32 indexed actionId,
        address indexed account,
        address indexed where,
        uint256 scheduledExecutionId
    );

    /**
     * @notice Emitted when a grant permission is scheduled.
     */
    event GrantPermissionScheduled(
        bytes32 indexed actionId,
        address indexed account,
        address indexed where,
        uint256 scheduledExecutionId
    );

    /**
     * @notice Emitted when a revoke delay change is scheduled.
     */
    event RevokeDelayChangeScheduled(
        bytes32 indexed actionId,
        uint256 indexed newDelay,
        uint256 indexed scheduledExecutionId
    );

    /**
     * @notice Emitted when a grant delay change is scheduled.
     */
    event GrantDelayChangeScheduled(
        bytes32 indexed actionId,
        uint256 indexed newDelay,
        uint256 indexed scheduledExecutionId
    );

    /**
     * @notice Emitted when a delay change is scheduled.
     */
    event DelayChangeScheduled(
        bytes32 indexed actionId,
        uint256 indexed newDelay,
        uint256 indexed scheduledExecutionId
    );

    /**
     * @notice Emitted when a new `delay` is set in order to perform action `actionId`.
     */
    event ActionDelaySet(bytes32 indexed actionId, uint256 delay);

    /**
     * @notice Emitted when a new execution `scheduledExecutionId` is scheduled.
     */
    event ExecutionScheduled(bytes32 indexed actionId, uint256 indexed scheduledExecutionId);

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
     * @notice A constant value for `scheduledExecutionId` that will match any execution Id.
     * Cancelers assigned to this Id will be able to cancel *any* scheduled execution,
     * which is very useful for e.g. emergency response dedicated teams that analyze these.
     */
    // solhint-disable-next-line func-name-mixedcase
    function GLOBAL_CANCELER_SCHEDULED_EXECUTION_ID() external view returns (uint256);

    /**
     * @notice A sentinel value for `where` that will match any address.
     */
    // solhint-disable-next-line func-name-mixedcase
    function EVERYWHERE() external view returns (address);

    /**
     * @notice We institute a maximum delay to ensure that actions cannot be accidentally/maliciously disabled through
     *         setting an arbitrarily long delay.
     */
    // solhint-disable-next-line func-name-mixedcase
    function MAX_DELAY() external view returns (uint256);

    /**
     * @notice We need a minimum delay period to ensure that all delay changes may be properly scrutinised.
     */
    // solhint-disable-next-line func-name-mixedcase
    function MINIMUM_CHANGE_DELAY_EXECUTION_DELAY() external view returns (uint256);

    /**
     * @notice Returns true if `account` is the root.
     */
    function isRoot(address account) external view returns (bool);

    /**
     * @notice Returns true if `account` is the pending root.
     */
    function isPendingRoot(address account) external view returns (bool);

    /**
     * @notice Returns the delay required to transfer the root address.
     */
    function getRootTransferDelay() external view returns (uint256);

    /**
     * @notice Returns the vault address.
     */
    function getVault() external view returns (address);

    /**
     * @notice Returns the TimelockExecutionHelper address.
     */
    function getTimelockExecutionHelper() external view returns (address);

    /**
     * @notice Returns the root address.
     */
    function getRoot() external view returns (address);

    /**
     * @notice Returns the currently pending new root address.
     */
    function getPendingRoot() external view returns (address);

    /**
     * @notice Returns true if `account` is allowed to grant permissions for action `actionId` in target `where`.
     */
    function isGranter(
        bytes32 actionId,
        address account,
        address where
    ) external view returns (bool);

    /**
     * @notice Returns true if `account` is allowed to revoke permissions in target `where` for all actions.
     */
    function isRevoker(address account, address where) external view returns (bool);

    /**
     * @notice Returns the scheduled execution `scheduledExecutionId`.
     */
    function getScheduledExecution(uint256 scheduledExecutionId) external view returns (ScheduledExecution memory);

    /**
     * @notice Returns the lifetime count of scheduled executions. The most recent scheduled execution will always have
     * a `scheduledExecutionId` of `getScheduledExecutionsCount() - 1`
     */
    function getScheduledExecutionsCount() external view returns (uint256);

    /**
     * @notice Returns multiple scheduled executions, in either chronological or reverse chronological order (if
     * `reverseOrder` is true).
     *
     * This function will return at most `maxSize` items, starting at index `skip` (meaning the first entries are
     * skipped). Note that when querying in reverse order, it is the newest entries that are skipped, not the oldest.
     *
     * The value of `skip` must be lower than the return value of `getScheduledExecutionsCount()`, which means that not
     * all scheduled executions can be skipped, and at least one execution will always be returned (assuming there are
     * any).
     *
     * Example calls:
     *  - { skip: 0, reverseOrder: false } : returns up to `maxSize` of oldest entries, with the oldest at index 0
     *  - { skip: 0, reverseOrder: true } : returns up to `maxSize` of the newest entries, with the newest at index 0
     *  - { skip: 5, reverseOrder: false } : returns up to `maxSize` of the oldest entries, skipping the 5 oldest
     *    entries, with the globally sixth oldest at index 0
     *  - { skip: 5, reverseOrder: true } : returns up to `maxSize` of the newest entries, skipping the 5 newest
     *    entries, with the globally sixth nexest at index 0
     */
    function getScheduledExecutions(
        uint256 skip,
        uint256 maxSize,
        bool reverseOrder
    ) external view returns (ITimelockAuthorizer.ScheduledExecution[] memory items);

    /**
     * @notice Returns true if `account` is an executor for `scheduledExecutionId`.
     */
    function isExecutor(uint256 scheduledExecutionId, address account) external view returns (bool);

    /**
     * @notice Returns true if execution `scheduledExecutionId` can be executed.
     * Only true if it is not already executed or canceled, and if the execution delay has passed.
     */
    function canExecute(uint256 scheduledExecutionId) external view returns (bool);

    /**
     * @notice Returns true if `account` is an canceler for `scheduledExecutionId`.
     */
    function isCanceler(uint256 scheduledExecutionId, address account) external view returns (bool);

    /**
     * @notice Schedules an execution to change the root address to `newRoot`.
     */
    function scheduleRootChange(address newRoot, address[] memory executors) external returns (uint256);

    /**
     * @notice Returns the execution delay for action `actionId`.
     */
    function getActionIdDelay(bytes32 actionId) external view returns (uint256);

    /**
     * @notice Returns the execution delay for granting permission for action `actionId`.
     */
    function getActionIdGrantDelay(bytes32 actionId) external view returns (uint256);

    /**
     * @notice Returns the execution delay for revoking permission for action `actionId`.
     */
    function getActionIdRevokeDelay(bytes32 actionId) external view returns (uint256);

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
    ) external view returns (bool);

    /**
     * @notice Returns true if `account` has permission over the action `actionId` in target `where`.
     */
    function hasPermission(
        bytes32 actionId,
        address account,
        address where
    ) external view returns (bool);

    /**
     * @notice Sets the pending root address to `pendingRoot`.
     * @dev This function can never be called directly - it is only ever called as part of a scheduled execution by
     * the TimelockExecutionHelper after after calling `scheduleRootChange`.
     *
     * Once set as the pending root, `pendingRoot` may then call `claimRoot` to become the new root.
     */
    function setPendingRoot(address pendingRoot) external;

    /**
     * @notice Transfers root powers from the current to the pending root address.
     * @dev This function prevents accidentally transferring root to an invalid address.
     * To become root, the pending root must call this function to ensure that it's able to interact with this contract.
     */
    function claimRoot() external;

    /**
     * @notice Executes a scheduled execution `scheduledExecutionId`. This is used to execute all scheduled executions,
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
     * scheduled execution during the execution of another scheduled execution - an unlikely and convoluted scenario
     * that we explicitly forbid.
     *
     * Note that while `execute` is nonReentrant, other functions are not - indeed, we rely on reentrancy to e.g. call
     * `setPendingRoot` or `setDelay`.
     */
    function execute(uint256 scheduledExecutionId) external returns (bytes memory result);

    /**
     * @notice Cancels a scheduled execution `scheduledExecutionId`, which prevents execution via `execute`. Canceling
     * is irreversible. Scheduled executions that have already been executed cannot be canceled. This is the only way to
     * prevent a scheduled execution from being executed (assuming there are willing executors).
     *
     * The caller must be a canceler, a permission which is managed by the `addCanceler` and `removeCanceler` functions.
     * Note that root is always a canceler for all scheduled executions.
     */
    function cancel(uint256 scheduledExecutionId) external;

    /**
     * @notice Grants canceler status to `account` for scheduled execution `scheduledExecutionId`.
     * @dev Only the root can add a canceler.
     *
     * Note that there are no delays associated with adding or removing cancelers. This is based on the assumption that
     * any action which a malicious user could exploit to damage the protocol can be mitigated by root.
     * Root can remove any canceler and reschedule any task
     */
    function addCanceler(uint256 scheduledExecutionId, address account) external;

    /**
     * @notice Remove canceler status from `account` for scheduled execution `scheduledExecutionId`.
     * @dev Only the root can remove a canceler.
     */
    function removeCanceler(uint256 scheduledExecutionId, address account) external;

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
    ) external;

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
    ) external;

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
    function addRevoker(address account, address where) external;

    /**
     * @notice Removes revoker status from `account` in target `where` for all actions.
     * @dev Only the root can remove revokers.
     *
     * Note that there are no delays associated with removing revokers.  The only instance in which one might be useful
     * is if we had contracts that were revoker, and this was depended upon for operation of the system. This however
     * doesn't seem like it will ever be required - revokers are typically subDAOs.
     */
    function removeRevoker(address account, address where) external;

    /**
     * @notice Sets a new delay `delay` for action `actionId`.
     * @dev This function can never be called directly - it is only ever called as part of a scheduled execution by
     * the TimelockExecutionHelper after after calling `scheduleDelayChange`.
     */
    function setDelay(bytes32 actionId, uint256 delay) external;

    /**
     * @notice Sets a new grant action delay `delay` for action `actionId`
     * @dev This function can never be called directly - it is only ever called as part of a scheduled execution by
     * the TimelockExecutor after after calling `scheduleGrantDelayChange`.
     * Delay has to be shorter than the Authorizer delay.
     */
    function setGrantDelay(bytes32 actionId, uint256 delay) external;

    /**
     * @notice Sets a new revoke action delay `delay` for action `actionId`
     * @dev This function can never be called directly - it is only ever called as part of a scheduled execution by
     * the TimelockExecutor after after calling `scheduleRevokeDelayChange`.
     * Delay has to be shorter than the Authorizer delay.
     */
    function setRevokeDelay(bytes32 actionId, uint256 delay) external;

    /**
     * @notice Schedules an execution to set the delay for `actionId`' to `newDelay`. This makes it impossible to
     * execute `actionId` without an immutable public on-chain commitment for the execution at least `newDelay` seconds
     * in advance.
     *
     * Critical actions that are expected to be performed by EOAs or multisigs are typically subject to such delays to
     * allow for public scrutiny.
     *
     * How long it will take to make this change will depend on the current and new delays: if increasing by more than
     * 5 days, then the time difference between the delays must pass. Otherwise, the minimum delay change execution
     * delay of 5 days must pass instead.
     *
     * Only `executors` will be able to execute the scheduled execution, unless `executors` is an empty array, in which
     * case any account can execute it.
     *
     * Avoid scheduling multiple delay changes for the same action at the same time, as this makes it harder to reason
     * about the state of the system. If there is already a scheduled delay change and there is a desire to change the
     * future delay to some other value, cancel the first scheduled change and schedule a new one.
     *
     * Only root can call this function, but other accounts may be granted permission to cancel the scheduled execution
     * (including global cancelers).
     */
    function scheduleDelayChange(
        bytes32 actionId,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256);

    /**
     * @notice Schedules an execution to set the delay for granting permission over `actionId` to `newDelay`. This makes
     * it impossible to grant permission to execute `actionId` without an immutable public on-chain commitment for the
     * granting at least `newDelay` seconds in advance.
     *
     * Critical actions that are expected to be performed by smart contracts are typically subject to such grant delays
     * to allow for public scrutiny of new contracts that are granted the permission.
     *
     * How long it will take to make this change will depend on the current and new grant delays: if increasing by more
     * than 5 days, then the time difference between the grant delays must pass. Otherwise, the minimum delay change
     * execution delay of 5 days must pass instead.
     *
     * Only `executors` will be able to execute the scheduled execution, unless `executors` is an empty array, in which
     * case any account can execute it.
     *
     * Avoid scheduling multiple grant delay changes for the same action at the same time, as this makes it harder to
     * reason about the state of the system. If there is already a scheduled grant delay change and there is a desire to
     * change the future grant delay to some other value, cancel the first scheduled change and schedule a new one.
     *
     * Only root can call this function, but other accounts may be granted permission to cancel the scheduled execution
     * (including global cancelers).
     */
    function scheduleGrantDelayChange(
        bytes32 actionId,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256);

    /**
     * @notice Schedules an execution to set the delay for revoking permission over `actionId` to `newDelay`. This makes
     * it impossible to revoke permission to execute `actionId` without an immutable public on-chain commitment for the
     * revoking at least `newDelay` seconds in advance.
     *
     * Critical actions that are performed by smart contracts and to which there is a long term commitment (e.g. minting
     * of BAL as part of the Liquidity Mining Program) are typically subject to such revoke delays, making it impossible
     * to disable the system without sufficient notice.
     *
     * How long it will take to make this change will depend on the current and new revoke delays: if increasing by more
     * than 5 days, then the time difference between the revoke delays must pass. Otherwise, the minimum delay change
     * execution delay of 5 days must pass instead.
     *
     * Only `executors` will be able to execute the scheduled execution, unless `executors` is an empty array, in which
     * case any account can execute it.
     *
     * Avoid scheduling multiple revoke delay changes for the same action at the same time, as this makes it harder to
     * reason about the state of the system. If there is already a scheduled revoke delay change and there is a desire
     * to change the future grant delay to some other value, cancel the first scheduled change and schedule a new one.
     *
     * Only root can call this function, but other accounts may be granted permission to cancel the scheduled execution
     * (including global cancelers).
     */
    function scheduleRevokeDelayChange(
        bytes32 actionId,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256);

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
    ) external returns (uint256);

    /**
     * @notice Grants a permission to a single `account` at 'where' address.
     * @dev This function can only be used for actions that have no grant delay. For those that do, use
     * `scheduleGrantPermission` instead.
     */
    function grantPermission(
        bytes32 actionId,
        address account,
        address where
    ) external;

    /**
     * @notice Schedules a grant permission to `account` for action `actionId` in target `where`.
     * See `schedule` comments.
     */
    function scheduleGrantPermission(
        bytes32 actionId,
        address account,
        address where,
        address[] memory executors
    ) external returns (uint256);

    /**
     * @notice Revokes a permission from a single `account` at `where` address.
     * @dev This function can only be used for actions that have no revoke delay. For those that do, use
     * `scheduleRevokePermission` instead.
     */
    function revokePermission(
        bytes32 actionId,
        address account,
        address where
    ) external;

    /**
     * @notice Schedules a revoke permission from `account` for action `actionId` in target `where`.
     * See `schedule` comments.
     */
    function scheduleRevokePermission(
        bytes32 actionId,
        address account,
        address where,
        address[] memory executors
    ) external returns (uint256);

    /**
     * @notice Revokes a permission from the caller for `actionId` at `where` address
     * @dev Note that the caller can always renounce permissions, even if revoking them would typically be
     * subject to a delay.
     */
    function renouncePermission(bytes32 actionId, address where) external;
}
