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

/**
 * @dev Simple mock for stakeless gauges, to verify single and multi checkpoint functionality.
 * This shouldn't be used to test gauge checkpoints by type, since the mock has no connection with the gauge controller
 * and hence the concept of gauge weights is not considered.
 */
contract MockStakelessGauge {
    event Checkpoint();

    address private immutable _authorizerAdaptor;

    uint256 private _totalBridgeCost;
    bool private _isKilled;

    constructor(address authorizerAdaptor) {
        _authorizerAdaptor = authorizerAdaptor;
    }

    function initialize(address, uint256) external {
        // solhint-disable-previous-line no-empty-blocks
    }

    function checkpoint() external payable returns (bool) {
        require(msg.sender == address(_authorizerAdaptor), "SENDER_NOT_ALLOWED");
        require(msg.value >= _totalBridgeCost, "Insufficient ETH to checkpoint");
        emit Checkpoint();
    }

    function setTotalBridgeCost(uint256 totalBridgeCost) external {
        _totalBridgeCost = totalBridgeCost;
    }

    function getTotalBridgeCost() external view returns (uint256) {
        return _totalBridgeCost;
    }

    // solhint-disable-next-line func-name-mixedcase
    function is_killed() external view returns (bool) {
        return _isKilled;
    }

    // These functions are permissioned in an actual gauge, but this mock should not be used to test that.
    function killGauge() external {
        _isKilled = true;
    }

    function unkillGauge() external {
        _isKilled = false;
    }
}
