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
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IAuthorizer.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "./TimelockExecutionHelper.sol";
import "./TimelockAuthorizerManagement.sol";

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
 * Note that the TimelockAuthorizer doesn't make use of reentrancy guards on the majority of external functions.
 * The only function which makes an external non-view call (and so could initate a reentrancy attack) is `execute`
 * which executes a scheduled execution and so this is the only protected function.
 * In fact a number of the TimelockAuthorizer's functions may only be called through a scheduled execution so reentrancy
 * is necessary in order to be able to call these.
 */
contract TimelockAuthorizer is IAuthorizer, TimelockAuthorizerManagement {
    IAuthorizerAdaptorEntrypoint private immutable _authorizerAdaptorEntrypoint;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;

    // action id => delay
    mapping(bytes32 => uint256) private _grantDelays;
    // action id => delay
    mapping(bytes32 => uint256) private _revokeDelays;

    // External permissions
    mapping(bytes32 => bool) private _isPermissionGranted;
    mapping(bytes32 => uint256) private _delaysPerActionId;

    constructor(
        address initialRoot,
        address nextRoot,
        IAuthorizerAdaptorEntrypoint authorizerAdaptorEntrypoint,
        uint256 rootTransferDelay
    ) TimelockAuthorizerManagement(initialRoot, nextRoot, authorizerAdaptorEntrypoint, rootTransferDelay) {
        _authorizerAdaptor = authorizerAdaptorEntrypoint.getAuthorizerAdaptor();
        _authorizerAdaptorEntrypoint = authorizerAdaptorEntrypoint;
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
                : account == getTimelockExecutionHelper();
    }

    /**
     * @notice Sets a new delay `delay` for action `actionId`.
     * @dev This function can never be called directly - it is only ever called as part of a scheduled execution by
     * the TimelockExecutionHelper after after calling `scheduleDelayChange`.
     */
    function setDelay(bytes32 actionId, uint256 delay) external onlyScheduled {
        // If changing the `setAuthorizer` delay itself, then we don't need to compare it to its current value for
        // validity.
        if (actionId != IAuthentication(getVault()).getActionId(IVault.setAuthorizer.selector)) {
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

        bytes32 setAuthorizerActionId = IAuthentication(getVault()).getActionId(IVault.setAuthorizer.selector);
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

        bytes memory data = abi.encodeWithSelector(this.setDelay.selector, actionId, newDelay);
        // TODO: add custom event

        // Since this can only be called by root, which is always a canceler for all scheduled executions, we don't
        // bother creating any new cancelers.
        uint256 scheduledExecutionId = _scheduleWithDelay(address(this), data, executionDelay, executors);
        emit DelayChangeScheduled(actionId, newDelay, scheduledExecutionId);
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
        emit GrantDelayChangeScheduled(actionId, newDelay, scheduledExecutionId);
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
        emit RevokeDelayChangeScheduled(actionId, newDelay, scheduledExecutionId);
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
        require(where != getTimelockExecutionHelper(), "ATTEMPTING_EXECUTION_HELPER_REENTRANCY");

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
     * @notice Grants a permission to a single `account` at 'where' address.
     * @dev This function can only be used for actions that have no grant delay. For those that do, use
     * `scheduleGrantPermission` instead.
     */
    function grantPermission(
        bytes32 actionId,
        address account,
        address where
    ) external {
        if (_grantDelays[actionId] == 0) {
            require(isGranter(actionId, msg.sender, where), "SENDER_IS_NOT_GRANTER");
        } else {
            // Some actions may have delays associated with granting them - these permissions cannot be granted
            // directly, even if the caller is a granter, and must instead be scheduled for future execution via
            // `scheduleGrantPermission`.
            require(msg.sender == getTimelockExecutionHelper(), "GRANT_MUST_BE_SCHEDULED");
        }

        bytes32 permission = getPermissionId(actionId, account, where);
        if (!_isPermissionGranted[permission]) {
            _isPermissionGranted[permission] = true;
            emit PermissionGranted(actionId, account, where);
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

        bytes memory data = abi.encodeWithSelector(this.grantPermission.selector, actionId, account, where);

        uint256 scheduledExecutionId = _scheduleWithDelay(address(this), data, delay, executors);
        emit GrantPermissionScheduled(actionId, account, where, scheduledExecutionId);
        // Granters that schedule actions are automatically made cancelers for them, so that they can manage their
        // action. We check that they are not already a canceler since e.g. root may schedule grants (and root is
        // always a global canceler).
        if (!isCanceler(scheduledExecutionId, msg.sender)) {
            _addCanceler(scheduledExecutionId, msg.sender);
        }
        return scheduledExecutionId;
    }

    /**
     * @notice Revokes a permission from a single `account` at `where` address.
     * @dev This function can only be used for actions that have no revoke delay. For those that do, use
     * `scheduleRevokePermission` instead.
     */
    function revokePermission(
        bytes32 actionId,
        address account,
        address where
    ) external {
        if (_revokeDelays[actionId] == 0) {
            require(isRevoker(msg.sender, where), "SENDER_IS_NOT_REVOKER");
        } else {
            // Some actions may have delays associated with revoking them - these permissions cannot be revoked
            // directly, even if the caller is a revoker, and must instead be scheduled for future execution via
            // `scheduleRevokePermission`.
            require(msg.sender == getTimelockExecutionHelper(), "REVOKE_MUST_BE_SCHEDULED");
        }
        _revokePermission(actionId, account, where);
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

        bytes memory data = abi.encodeWithSelector(this.revokePermission.selector, actionId, account, where);

        uint256 scheduledExecutionId = _scheduleWithDelay(address(this), data, delay, executors);
        emit RevokePermissionScheduled(actionId, account, where, scheduledExecutionId);
        // Revokers that schedule actions are automatically made cancelers for them, so that they can manage their
        // action. We check that they are not already a canceler since e.g. root may schedule revokes (and root is
        // always a global canceler).
        if (!isCanceler(scheduledExecutionId, msg.sender)) {
            _addCanceler(scheduledExecutionId, msg.sender);
        }
        return scheduledExecutionId;
    }

    /**
     * @notice Revokes a permission from the caller for `actionId` at `where` address
     * @dev Note that the caller can always renounce permissions, even if revoking them would typically be
     * subject to a delay.
     */
    function renouncePermission(bytes32 actionId, address where) external {
        _revokePermission(actionId, msg.sender, where);
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
}
