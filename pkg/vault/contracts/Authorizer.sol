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
    
    mapping(bytes32 => uint256) actionDelays;
    mapping(bytes32 => EnumerableSet.AddressSet) delayedCalls;

    /**
     * @dev Emitted when a call is scheduled as part of operation `actionId`.
     */
    event DelayedCallScheduled(
        bytes32 indexed actionId,
        address where,
        uint256 value,
        bytes data,
        uint256 delay
    );

    event ActionDelaySet(bytes32 indexed actionId, uint256 delay);

    constructor(address admin) {
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
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
        if (actionDelays[actionId] == 0) {
            return AccessControl.hasRole(actionId, account, where);
        } else {
            return delayedCalls[actionId].contains(msg.sender);
        }
    }

    /**
        Delayed actions
    
    */
    function setActionDelay(bytes32 actionId, uint256 delay, address where) public {
        require(AccessControl.hasRole(actionId, msg.sender, where), "Invalid permission");
        actionDelays[actionId] = delay;
        emit ActionDelaySet(actionId, delay);
    }

    function setActionDelays(
        bytes32[] calldata actionIds,
        uint256[] calldata delays,
        address[] calldata wheres
    ) external {
        require(actionIds.length == delays.length && delays.length == wheres.length, "Arrays with unequal lenght");
        for (uint256 i = 0; i < actionIds.length; i++) {
            setActionDelay(actionIds[i], delays[i], wheres[i]);
        }
    }

    function getDelay(bytes32 actionId) external override view returns (uint256) {
        return actionDelays[actionId];
    }

    function getDelayedCallsAt(bytes32 actionId, uint256 index) external view returns (address) {
        return delayedCalls[actionId].at(index);
    }

    function getDelayedCallsCount(bytes32 actionId) external view returns (uint256) {
        return delayedCalls[actionId].length();
    }

    /**
     * @dev deploys a contract that will allow the triggering of a delayed action.
     */
    function deployDelayedCall(
        bytes32 actionId,
        address where,
        uint256 value,
        bytes calldata data
    ) external returns(address) {
        require(AccessControl.hasRole(actionId, msg.sender, where), "Invalid permission");
        require(actionDelays[actionId] > 0, "Not a delayed action");
        DelayedCall delayedCall = new DelayedCall(data, where, value, this, actionId);
        delayedCalls[actionId].add(address(delayedCall));
        emit DelayedCallScheduled(actionId, where, value, data, actionDelays[actionId]);
        return address(delayedCall);
    }

    /**
     * @dev Grants multiple roles to a single account for a set of contracts.
     */
    function grantRoles(bytes32[] memory roles, address account, address[] calldata where) external {
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
    function grantRolesToMany(bytes32[] memory roles, address[] memory accounts, address[] calldata where) external {
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
    function revokeRoles(bytes32[] memory roles, address account, address[] calldata where) external {
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
    function revokeRolesFromMany(bytes32[] memory roles, address[] memory accounts, address[] calldata where) external {
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
