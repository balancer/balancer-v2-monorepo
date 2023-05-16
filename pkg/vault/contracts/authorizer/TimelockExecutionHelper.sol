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
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "@balancer-labs/v2-interfaces/contracts/vault/IAuthorizer.sol";

import "./TimelockAuthorizer.sol";

/**
 * @dev Helper contract that is used by the TimelockAuthorizer to execute scheduled executions.
 *
 * This contract always has permission to call any permissioned function in any contract, as long as they have a delay.
 * That is, `canPerform` always returns true for the ExecutionHelper for delayed executions. Additionally, native
 * Timelock scheduled functions (such as setDelay or setPendingRoot) can also only be called by the ExecutionHelper.
 *
 * The ExecutionHelper features a single function, `execute`, which then performs an arbitrary function call on any
 * address. This is how functions that have delays associated are called. However, only the TimelockAuthorizer itself
 * can call `execute`, and will only do so once a valid execution has been scheduled by a properly authorized party, and
 * the delay in question has passed.
 *
 * Therefore, any function called by the ExecutionHelper originates from an `execute` call, which in turn originates
 * from the TimelockAuthorizer having completed all permission and delay validation.
 */
contract TimelockExecutionHelper is ReentrancyGuard {
    TimelockAuthorizer private immutable _authorizer;

    constructor() {
        // This contract is expected to never be deployed directly, and instead to be created by the TimelockAuthorizer
        // as part of its construction.
        _authorizer = TimelockAuthorizer(msg.sender);
    }

    function getAuthorizer() external view returns (IAuthorizer) {
        return _authorizer;
    }

    /**
     * @dev Calls `target` with `data`. Because the ExecutionHelper is authorized to call any permission function that
     * has a delay, this is a very powerful call. However, only the TimelockAuthorizer can initiate it, and it should
     * only do so after having validated that the conditions to perform a delayed execution have been met.
     *
     * We mark this function as `nonReentrant` out of an abundance of caution, as in theory this and the Authorizer
     * should be resilient to reentrant executions. The non-reentrancy check means that it is not possible to execute a
     * scheduled execution during the execution of another scheduled execution - an unlikely and convoluted scenario
     * that we knowingly forbid.
     */
    function execute(address target, bytes memory data) external nonReentrant returns (bytes memory) {
        require(msg.sender == address(_authorizer), "SENDER_IS_NOT_AUTHORIZER");
        return Address.functionCall(target, data);
    }
}
