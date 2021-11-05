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

import "../interfaces/IDelayProvider.sol";
import "../interfaces/IAuthorizer.sol";

contract MockDelayedCallCreator is IDelayProvider, IAuthorizer {

    bool private _canPerform;
    uint256 private _delay;
    event MockActionTriggered(uint256 indexed param);
    uint256 public triggeredValue;

    function setCanPerform(bool value) external {
        _canPerform = value;
    }

    function setDelay(uint256 value) external {
        _delay = value;
    }

    function canPerform(
        bytes32 actionId,
        address account,
        address where
    ) external view override returns (bool) {
        return _canPerform;
    }
    
     
    function getDelay(bytes32 actionId) external override view returns (uint256) {
        return _delay;
    }

    function targetAction(uint256 someParam) external {
        triggeredValue = someParam;
        emit MockActionTriggered(someParam);
    }

    function setTriggeredValue(uint256 value) external {
        triggeredValue = value;
    }   



}