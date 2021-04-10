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

import "./BalancerErrors.sol";

/**
 * @dev Provide "Emergency Stop" functionality that is automatically disabled after a time, after which it
 * turns off and can no longer be turned on.
 *
 * The Emergency Period end date is initialized on creation, and cannot be set longer than _MAX_EMERGENCY_PERIOD
 * days in the future. During this period `_setEmergencyPeriod` can be called to either activate
 * or deactivate the emergency stop.
 *
 * If the emergency stop is active when the end date passes, it will remain active for an additional period after which
 * it will be automatically deactivated forever. This additional time period is also set on creation, and is limited to
 * _MAX_EMERGENCY_PERIOD_CHECK_EXT days. This provides enough time to react to the issue, even if the
 * emergency period is about to expire.
 *
 * At any point the Emergency Switch can be turned off. This is a cautionary measure: it lets the Emergency Switch
 * managers react quickly to potentially dangerous situations, knowing this action can be later reverted if careful
 * analysis indicates this was a false positive.
 */
abstract contract EmergencyPeriod {
    // This contract uses timestamps to
    // solhint-disable not-rely-on-time

    uint256 private constant _MAX_EMERGENCY_PERIOD = 90 days;
    uint256 private constant _MAX_EMERGENCY_PERIOD_CHECK_EXT = 30 days;

    bool private _emergencyPeriodActive;
    uint256 private immutable _emergencyPeriodEndDate;
    uint256 private immutable _emergencyPeriodCheckEndDate;

    event EmergencyPeriodChanged(bool active);

    modifier noEmergencyPeriod() {
        _ensureInactiveEmergencyPeriod();
        _;
    }

    constructor(uint256 emergencyPeriod, uint256 emergencyPeriodCheckExtension) {
        _require(emergencyPeriod <= _MAX_EMERGENCY_PERIOD, Errors.MAX_EMERGENCY_PERIOD);
        _require(
            emergencyPeriodCheckExtension <= _MAX_EMERGENCY_PERIOD_CHECK_EXT,
            Errors.MAX_EMERGENCY_PERIOD_CHECK_EXT
        );

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
        return (!_isEmergencyPeriodInactive(), _getEmergencyPeriodEndDate(), _getEmergencyPeriodCheckEndDate());
    }

    function _setEmergencyPeriod(bool active) internal {
        uint256 maxEndDate = active ? _getEmergencyPeriodEndDate() : _getEmergencyPeriodCheckEndDate();
        _require(block.timestamp < maxEndDate, Errors.EMERGENCY_PERIOD_FINISHED);
        _emergencyPeriodActive = active;
        emit EmergencyPeriodChanged(active);
    }

    function _ensureInactiveEmergencyPeriod() internal view {
        _require(_isEmergencyPeriodInactive(), Errors.EMERGENCY_PERIOD_ON);
    }

    function _isEmergencyPeriodInactive() internal view returns (bool) {
        return (block.timestamp >= _getEmergencyPeriodCheckEndDate()) || !_emergencyPeriodActive;
    }

    function _getEmergencyPeriodEndDate() internal view returns (uint256) {
        return _emergencyPeriodEndDate;
    }

    function _getEmergencyPeriodCheckEndDate() internal view returns (uint256) {
        return _emergencyPeriodCheckEndDate;
    }
}
