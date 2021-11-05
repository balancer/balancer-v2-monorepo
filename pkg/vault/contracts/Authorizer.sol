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

import "./interfaces/IAuthorizer.sol";
import "./interfaces/IDelayProvider.sol";
import "./DelayedCall.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/AccessControl.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
/**
 * @dev Basic Authorizer implementation, based on OpenZeppelin's Access Control.
 *
 * Users are allowed to perform actions if they have the role with the same identifier. In this sense, roles are not
 * being truly used as such, since they each map to a single action identifier.
 *
 * This temporary implementation is expected to be replaced soon after launch by a more sophisticated one, able to
 * manage permissions across multiple contracts and to natively handle timelocks.
 */
contract Authorizer is AccessControl, IAuthorizer, IDelayProvider {
    using EnumerableSet for EnumerableSet.AddressSet;
    mapping(bytes32 => uint256) private _actionDelays;
    mapping(bytes32 => EnumerableSet.AddressSet) private _delayedCalls;
    uint256 constant public _MIN_DELAY = 3600; // 1h in seconds
    bytes32 constant public _SET_ACTION_DELAY = keccak256(abi.encodePacked(Authorizer.setActionDelay.selector));
    /**
     * @dev Emitted when a call is scheduled as part of operation `actionId`.
     */
    event DelayedCallScheduled(bytes32 indexed actionId, address callAddress, address where, uint256 value, bytes data, uint256 delay);

    event ActionDelaySet(bytes32 indexed actionId, uint256 delay);

    constructor(address admin) {
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        _setActionDelay(_SET_ACTION_DELAY, _MIN_DELAY);
    }

    /**
     * @dev checks if caller can execute an action in a contract. If actions has
     * a defined delay, caller must be a DelayedCall contract
     */
    function canPerform(
        bytes32 actionId,
        address account,
        address where
    ) public view override returns (bool) {
        if (_actionDelays[actionId] == 0) {
            return AccessControl.hasRole(actionId, account, where);
        } else {
            return _delayedCalls[actionId].contains(msg.sender);
        }
    }

    /**
        Delayed actions
    
    */
    function setActionDelay(
        bytes32 actionId,
        uint256 delay
    ) external {
        require(canPerform(_SET_ACTION_DELAY, msg.sender, GLOBAL_ROLE_ADMIN), "Cannot schedule");
        _setActionDelay(actionId, delay);
    }

    function _setActionDelay(bytes32 actionId, uint256 delay) internal {
        require(delay >= _MIN_DELAY, "Delay too short");
        _actionDelays[actionId] = delay;
        emit ActionDelaySet(actionId, delay);
    }

    function getDelay(bytes32 actionId) external view override returns (uint256) {
        return _actionDelays[actionId];
    }

    function getDelayedCallsAt(bytes32 actionId, uint256 index) external view returns (address) {
        return _delayedCalls[actionId].at(index);
    }

    function getDelayedCallsCount(bytes32 actionId) external view returns (uint256) {
        return _delayedCalls[actionId].length();
    }

    /**
     * @dev deploys a contract that will allow the triggering of a delayed action.
     */
    function deployDelayedCall(
        bytes32 actionId,
        address where,
        uint256 value,
        bytes calldata data,
        bool permissionedTrigger
    ) external returns(address) {
        require(AccessControl.hasRole(actionId, msg.sender, where), "Invalid permission");
        uint256 delay = _actionDelays[actionId];
        require(delay > 0, "Not a delayed action");
        DelayedCall delayedCall = new DelayedCall(data, where, value, this, this, permissionedTrigger, actionId);
        _delayedCalls[actionId].add(address(delayedCall));
        emit DelayedCallScheduled(actionId, address(delayedCall), where, value, data, delay);
        return address(delayedCall);
    }

    /**
     * @dev Grants multiple roles to a single account for a set of contracts.
     */
    function grantRoles(
        bytes32[] memory roles,
        address account,
        address[] calldata where
    ) external {
        for (uint256 i = 0; i < roles.length; i++) {
            grantRole(roles[i], account, where);
        }
    }

    /**
     * @dev Grants multiple roles to a single account for all contracts.
     */
    function grantRolesGlobally(bytes32[] memory roles, address account) external {
        for (uint256 i = 0; i < roles.length; i++) {
            grantRoleGlobally(roles[i], account);
        }
    }

    /**
     * @dev Grants roles to a list of accounts for a set of contracts.
     */
    function grantRolesToMany(
        bytes32[] memory roles,
        address[] memory accounts,
        address[] calldata where
    ) external {
        InputHelpers.ensureInputLengthMatch(roles.length, accounts.length);
        for (uint256 i = 0; i < roles.length; i++) {
            grantRole(roles[i], accounts[i], where);
        }
    }

    /**
     * @dev Grants roles to a list of accounts for all contracts.
     */
    function grantRolesGloballyToMany(bytes32[] memory roles, address[] memory accounts) external {
        InputHelpers.ensureInputLengthMatch(roles.length, accounts.length);
        for (uint256 i = 0; i < roles.length; i++) {
            grantRoleGlobally(roles[i], accounts[i]);
        }
    }

    /**
     * @dev Revokes multiple roles from a single account for a set of contracts.
     */
    function revokeRoles(
        bytes32[] memory roles,
        address account,
        address[] calldata where
    ) external {
        for (uint256 i = 0; i < roles.length; i++) {
            revokeRole(roles[i], account, where);
        }
    }

    /**
     * @dev Revokes multiple roles from a single account for all contracts.
     */
    function revokeRolesGlobally(bytes32[] memory roles, address account) external {
        for (uint256 i = 0; i < roles.length; i++) {
            revokeRoleGlobally(roles[i], account);
        }
    }

    /**
     * @dev Revokes roles from a list of accounts across a set of contracts
     */
    function revokeRolesFromMany(
        bytes32[] memory roles,
        address[] memory accounts,
        address[] calldata where
    ) external {
        InputHelpers.ensureInputLengthMatch(roles.length, accounts.length);
        for (uint256 i = 0; i < roles.length; i++) {
            revokeRole(roles[i], accounts[i], where);
        }
    }

    /**
     * @dev Revokes roles from a list of accounts.
     */
    function revokeRolesGloballyFromMany(bytes32[] memory roles, address[] memory accounts) external {
        InputHelpers.ensureInputLengthMatch(roles.length, accounts.length);
        for (uint256 i = 0; i < roles.length; i++) {
            revokeRoleGlobally(roles[i], accounts[i]);
        }
    }
}
