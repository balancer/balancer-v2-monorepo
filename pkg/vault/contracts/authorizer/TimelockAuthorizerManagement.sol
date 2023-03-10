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

/**
 * @title Timelock Authorizer Management
 * @author Balancer Labs
 * @dev TODO
 *
 */
contract TimelockAuthorizerManagement is ReentrancyGuard {
    using Address for address;

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

    TimelockExecutionHelper private immutable _executionHelper;
    IAuthentication private immutable _vault;
    uint256 private immutable _rootTransferDelay;

    // Authorizer permissions
    address private _root;
    address private _pendingRoot;

    // scheduled execution id => account => is executor
    mapping(uint256 => mapping(address => bool)) private _isExecutor;

    // action id => account => where => is granter
    mapping(bytes32 => mapping(address => mapping(address => bool))) private _isGranter;
    // account => where => is revoker
    mapping(address => mapping(address => bool)) private _isRevoker;
    // scheduled execution id => account => is canceler
    mapping(uint256 => mapping(address => bool)) private _isCanceler;

    ScheduledExecution[] private _scheduledExecutions;


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
     * @notice Emitted when an execution `scheduledExecutionId` is cancelled.
     */
    event ExecutionCancelled(uint256 indexed scheduledExecutionId);

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
        _executionHelper = new TimelockExecutionHelper();
        _rootTransferDelay = rootTransferDelay;
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
    function getVault() public view returns (address) {
        return address(_vault);
    }

    /**
     * @notice Returns the TimelockExecutionHelper address.
     */
    function getTimelockExecutionHelper() public view returns (address) {
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
        bytes memory data = abi.encodeWithSelector(this.setPendingRoot.selector, newRoot);

        // Since this can only be called by root, which is always a canceler for all scheduled executions, we don't
        // bother creating any new cancelers.
        uint256 scheduledExecutionId = _scheduleWithDelay(address(this), data, getRootTransferDelay(), executors);

        emit RootChangeScheduled(newRoot, scheduledExecutionId);
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
        address pendingRoot = _pendingRoot;
        require(msg.sender == pendingRoot, "SENDER_IS_NOT_PENDING_ROOT");

        // Complete the root transfer and reset the pending root.
        _setRoot(pendingRoot);
        _setPendingRoot(address(0));
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

    function _addCanceler(uint256 scheduledExecutionId, address account) internal {
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

    function _scheduleWithDelay(
        address where,
        bytes memory data,
        uint256 delay,
        address[] memory executors
    ) internal returns (uint256 scheduledExecutionId) {
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
}
