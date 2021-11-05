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

import "./interfaces/IDelayProvider.sol";
import "./interfaces/IAuthorizer.sol";
contract DelayedCall {

    IDelayProvider private _delayProvider;
    IAuthorizer private _authorizer;
    bool public triggered = false;
    uint256 public start;
    address public where;
    bytes public data;
    bytes32 public actionId;
    uint256 public value;
    bool public immutable isTriggerPermissioned;
    bool public cancelled;

    /**
    * @dev Emitted when a call is performed as part of operation `id`.
    */
    event DelayedCallExecuted(bytes32 indexed actionId, address where, uint256 value, bytes data);

    /**
    * @dev Emitted when a call is cancelled
    */
    event DelayedCallCancelled(bytes32 indexed actionId, address where, uint256 value, bytes data);


    constructor(
        bytes memory _data,
        address _where,
        uint256 _value,
        IDelayProvider __delayProvider,
        IAuthorizer __authorizer,
        bool _isTriggerPermissioned,
        bytes32 _actionId
    ) {
        require(address(__delayProvider) != address(0), "Empty delay provider");
        require(address(_where) != address(0), "Where cannot be zero address");
        require(_actionId != "", "Invalid actionId");
        require(address(__authorizer) != address(0), "IAuthorizer cannot be zero address");
        _delayProvider = __delayProvider;
        _authorizer = __authorizer;
        isTriggerPermissioned = _isTriggerPermissioned;
        where = _where;
        data = _data;
        start = block.timestamp;
        value = _value;
        actionId = _actionId;
        cancelled = false;
    }
  
    function trigger() external {
        require(!cancelled, "Action is cancelled");
        require(isReadyToCall(), "Action triggered too soon");
        if (isTriggerPermissioned) {
            require(_authorizer.canPerform(actionId, msg.sender, where), "Not Authorized");
        }
        require(!triggered, "Action already triggered");
        triggered = true;
        (bool success, ) = where.call{value: value}(data);
        require(success, "Underlying transaction reverted");
        emit DelayedCallExecuted(actionId, where, value, data);
    }
    
    function cancel() external {
        require(_authorizer.canPerform(actionId, msg.sender, where), "Not Authorized");
        require(!cancelled, "Action already cancelled");
        require(!triggered, "Cannot cancel triggered action");
        cancelled = true;
        emit DelayedCallCancelled(actionId, where, value, data);
    }

    function isReadyToCall() public view returns(bool) {
        return block.timestamp > _delayProvider.getDelay(actionId) + start; 
    }


}
