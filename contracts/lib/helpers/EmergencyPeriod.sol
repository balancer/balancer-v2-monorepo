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


// solhint-disable no-rely-on-time
contract EmergencyPeriod {
    uint256 private constant _MAX_EMERGENCY_PERIOD = 90 days;
    uint256 private constant _MAX_EMERGENCY_PERIOD_CHECK_EXT = 30 days;

    bool private _emergencyPeriodActive;
    uint256 internal immutable _emergencyPeriodEndDate;
    uint256 internal immutable _emergencyPeriodCheckEndDate;

    event EmergencyPeriodChanged(bool active);

    modifier noEmergencyPeriod() {
        _ensureInactiveEmergencyPeriod();
        _;
    }

    constructor (uint256 emergencyPeriod, uint256 emergencyPeriodCheckExtension) {
        require(emergencyPeriod <= _MAX_EMERGENCY_PERIOD, "MAX_EMERGENCY_PERIOD");
        require(emergencyPeriodCheckExtension <= _MAX_EMERGENCY_PERIOD_CHECK_EXT, "MAX_EMERGENCY_PERIOD_CHECK_EXT");

        _emergencyPeriodEndDate = block.timestamp + emergencyPeriod;
        _emergencyPeriodCheckEndDate = block.timestamp + emergencyPeriod + emergencyPeriodCheckExtension;
    }

    function getEmergencyPeriod()
        external
        view
        returns (
            bool active,
            uint256 endDate,
            uint256 checkEndDate
        )
    {
        return (!_isEmergencyPeriodInactive(), _emergencyPeriodEndDate, _emergencyPeriodCheckEndDate);
    }

    function _setEmergencyPeriod(bool active) internal {
        require(block.timestamp < _emergencyPeriodEndDate, "EMERGENCY_PERIOD_FINISHED");
        _emergencyPeriodActive = active;
        emit EmergencyPeriodChanged(active);
    }

    function _ensureInactiveEmergencyPeriod() internal view {
        require(_isEmergencyPeriodInactive(), "EMERGENCY_PERIOD_ON");
    }

    function _isEmergencyPeriodInactive() internal view returns (bool) {
        return (block.timestamp >= _emergencyPeriodCheckEndDate) || !_emergencyPeriodActive;
    }
}
