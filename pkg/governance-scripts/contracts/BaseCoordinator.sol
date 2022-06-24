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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAuthorizerAdaptor.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

// solhint-disable not-rely-on-time

/**
 * @dev The currently deployed Authorizer has a different interface relative to the Authorizer in the monorepo
 * for granting/revoking roles(referred to as permissions in the new Authorizer) and so we require a one-off interface
 */
interface ICurrentAuthorizer is IAuthorizer {
    // solhint-disable-next-line func-name-mixedcase
    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);

    function grantRole(bytes32 role, address account) external;

    function revokeRole(bytes32 role, address account) external;

    function renounceRole(bytes32 role, address account) external;
}

abstract contract BaseCoordinator is SingletonAuthentication, ReentrancyGuard {
    IAuthorizerAdaptor private immutable _authorizerAdaptor;

    function()[] private _coordinatorStages;
    uint256[] private _stageActivationTime;

    constructor(IAuthorizerAdaptor authorizerAdaptor) SingletonAuthentication(authorizerAdaptor.getVault()) {
        _authorizerAdaptor = authorizerAdaptor;
    }

    function getAuthorizerAdaptor() public view returns (IAuthorizerAdaptor) {
        return _authorizerAdaptor;
    }

    function isComplete() public view returns (bool) {
        uint256 currentStage = getCurrentStage();
        // currentStage > 0 ensures that coordinator is not marked as complete when getStagesLength == 0.
        // This prevents `isComplete` returning true on deployment of the coordinator.
        return currentStage > 0 && currentStage >= getStagesLength();
    }

    function getCurrentStage() public view returns (uint256) {
        // We push the activation time onto the _stageActivationTime array after each stage.
        // We can then use the length of this array as a proxy for the next stage to be performed.
        return _stageActivationTime.length;
    }

    function getStagesLength() public view returns (uint256) {
        return _coordinatorStages.length;
    }

    function getStageActivationTime(uint256 stage) public view returns (uint256) {
        return _stageActivationTime[stage];
    }

    function registerStages() external nonReentrant {
        require(getStagesLength() == 0, "Coordinator stages already registered");
        _registerStages();
    }

    function _registerStages() internal virtual;

    function _registerStage(function() internal coordinatorStage) internal {
        _coordinatorStages.push(coordinatorStage);
    }

    function performNextStage() external nonReentrant {
        // If nobody has explicitly registered the stages manually before performing the first stage then do so now.
        if (getStagesLength() == 0) _registerStages();

        require(!isComplete(), "All stages completed");

        _coordinatorStages[getCurrentStage()]();

        _advanceCurrentStage();
    }

    function _getTimeSinceLastStageActivation() internal view returns (uint256) {
        uint256 currentStage = getCurrentStage();
        require(currentStage > 0, "First stage has not yet been activated");
        return block.timestamp - getStageActivationTime(currentStage - 1);
    }

    function _advanceCurrentStage() private {
        _stageActivationTime.push(block.timestamp);

        if (isComplete()) {
            _afterLastStage();
        }
    }

    function _afterLastStage() internal virtual;
}
