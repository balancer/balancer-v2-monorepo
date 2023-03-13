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
 * @dev We need this interface to avoid overriding functions at TimelockAuthorizer
 */
interface ITimelockAuthorizerManagement {
    struct ScheduledExecution {
        address where;
        bytes data;
        bool executed;
        bool cancelled;
        bool protected;
        uint256 executableAt;
    }

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
     * @notice Returns true if `account` is an executor for `scheduledExecutionId`.
     */
    function isExecutor(uint256 scheduledExecutionId, address account) external view returns (bool);

    /**
     * @notice Returns true if execution `scheduledExecutionId` can be executed.
     * Only true if it is not already executed or cancelled, and if the execution delay has passed.
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
     * @notice Executes a scheduled action `scheduledExecutionId`. This is used to execute all scheduled executions,
     * not only those that originate from `schedule`, but also internal TimelockAuthorizer functions such as
     * `scheduleRootChange` or `scheduleDelayChange`.
     *
     * If any executors were set up when scheduling, `execute` can only be called by them. If none were set, the
     * scheduled execution is said to be 'unprotected', and can be executed by anyone.
     *
     * Once executed, a scheduled execution cannot be executed again. It also cannot be executed if canceled.
     */
    function execute(uint256 scheduledExecutionId) external returns (bytes memory result);

    /**
     * @notice Cancels a scheduled action `scheduledExecutionId`, which prevents execution via `execute`. Canceling is
     * irreversible. Scheduled executions that have already been executed cannot be canceled. This is the only way to
     * prevent a scheduled execution from being executed (assuming there are willing executors).
     *
     * The caller must be a canceler, a permission which is managed by the `addCanceler` and `removeCanceler` functions.
     * Note that root is always a canceler for all scheduled executions.
     */
    function cancel(uint256 scheduledExecutionId) external;

    /**
     * @notice Grants canceler status to `account` for scheduled action `scheduledExecutionId`.
     * @dev Only the root can add a canceler.
     *
     * Note that there are no delays associated with adding or removing cancelers. This is based on the assumption that
     * any action which a malicious user could exploit to damage the protocol can be mitigated by root.
     * Root can remove any canceler and reschedule any task
     */
    function addCanceler(uint256 scheduledExecutionId, address account) external;

    /**
     * @notice Remove canceler status from `account` for scheduled action `scheduledExecutionId`.
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
}

/**
 * @dev We need this interface to avoid overriding functions at TimelockAuthorizer
 */
interface ITimelockAuthorizerPartial {
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
     * @notice Returns the permission ID for action `actionId`, account `account` and target `where`.
     */
    function getPermissionId(
        bytes32 actionId,
        address account,
        address where
    ) external pure returns (bytes32);

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
     * @notice Schedules an execution to set the delay for `actionId`' to `newDelay`.
     * See `schedule` comments.
     */
    function scheduleDelayChange(
        bytes32 actionId,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256);

    /**
     * @notice Schedules an execution to set the delay for granting permission over `actionId` to `newDelay`.
     * See `schedule` comments.
     */
    function scheduleGrantDelayChange(
        bytes32 actionId,
        uint256 newDelay,
        address[] memory executors
    ) external returns (uint256);

    /**
     * @notice Schedules an execution to set the delay for revoking permission over `actionId` to `newDelay`.
     * See `schedule` comments.
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

interface ITimelockAuthorizer is ITimelockAuthorizerPartial, ITimelockAuthorizerManagement {}
