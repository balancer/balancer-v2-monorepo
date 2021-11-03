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

contract DelayedCall {

    bool private _triggered = false;
    IDelayProvider private delayProvider;
    uint256 public start;
    address public where;
    bytes public data;
    bytes32 public actionId;
    uint256 public value;

    /**
    * @dev Emitted when a call is performed as part of operation `id`.
    */
    event CallExecuted(bytes32 indexed actionId, address where, uint256 value, bytes data);

    constructor(
        bytes memory _data,
        address _where,
        uint256 _value,
        IDelayProvider _delayProvider,
        bytes32 _actionId
    ) {
        require(address(delayProvider) != address(0), "Empty delay provider");
        require(address(_where) != address(0), "Where cannot be zero address");
        require(_actionId != "", "Invalid actionId");
        delayProvider = _delayProvider;
        where = _where;
        data = _data;
        start = block.timestamp;
        value = _value;
        actionId = _actionId;
    }
  
    function trigger() external {
        require(isReadyToCall(), "Action triggered too soon");
        require(!_triggered, "Action already triggered");
        _triggered = true;
        (bool success, ) = where.call{value: value}(data);
        require(success, "Underlying transaction reverted");
        emit CallExecuted(actionId, where, value, data);
    }

    function isReadyToCall() public view returns(bool) {
        return block.timestamp > delayProvider.getDelay(actionId) + start; 
    }   

}
