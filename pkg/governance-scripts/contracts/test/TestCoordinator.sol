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

import "../BaseCoordinator.sol";

contract TestCoordinator is BaseCoordinator {
    event RegisterStagesHookCalled();
    event StagePerformed(uint256 stageNumber);
    event AfterLastStageHookExecuted();

    constructor(IAuthorizerAdaptor authorizerAdaptor) BaseCoordinator(authorizerAdaptor) {
        // solhint-disable-previous-line no-empty-blocks
    }

    // Coordinator Setup

    function _registerStages() internal override {
        _registerStage(_performStageOne);
        _registerStage(_performStageTwo);
        _registerStage(_performStageThree);
        _registerStage(_performStageFour);
        emit RegisterStagesHookCalled();
    }

    function _afterLastStage() internal virtual override {
        emit AfterLastStageHookExecuted();
    }

    // Internal functions

    function _performStageOne() private {
        emit StagePerformed(1);
    }

    function _performStageTwo() private {
        emit StagePerformed(2);
    }

    function _performStageThree() private {
        emit StagePerformed(3);
    }

    function _performStageFour() private {
        emit StagePerformed(4);
    }

    // External functions

    function getTimeSinceLastStageActivation() external view returns (uint256) {
        return _getTimeSinceLastStageActivation();
    }
}
