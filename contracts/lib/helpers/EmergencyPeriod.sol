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
 * @dev Provide "Emergency Stop" functionality for the Vault and Pools, for a limited time - after which the
 * protocol becomes trustless (aside from standard governance functions such as setting protocol fees,
 * designating oracles, approving relayers, etc.)
 *
 * The Emergency Period end date is initialized on creation, and cannot be set longer than _MAX_EMERGENCY_PERIOD
 * days in the future. During this period, governance may call `setEmergencyPeriod` on either the Vault, or
 * an individual Pool.
 *
 * Setting emergency mode on the Vault halts all swaps, flash loans, and internal balance deposits or transfers.
 * It also prevents creating new Pools, or modifying the token composition of Pools. All users can do is withdraw
 * from their internal balances.
 *
 * Setting emergency mode on a Pool prevents swaps with that pool, adding liquidity, and single asset exit.
 * All users can do is exit (proportionally, or defining the tokens to be withdrawn).
 *
 * Emergency mode can also be canceled before the _emergencyPeriodEndDate. If the Vault (or a Pool) is in emergency
 * mode when the end date passes, it will remain "locked" for an additional period, and can no longer be turned back
 * on until that period expires. The additional time period is also set on creation, and is limited to
 * _MAX_EMERGENCY_PERIOD_CHECK_EXT days. This allows time for any redeployment/liquidity migration that
 * may be necessary.
 */
// solhint-disable not-rely-on-time
abstract contract EmergencyPeriod {
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
        return (!_isEmergencyPeriodInactive(), _emergencyPeriodEndDate, _emergencyPeriodCheckEndDate);
    }

    function _setEmergencyPeriod(bool active) internal {
        _require(block.timestamp < _emergencyPeriodEndDate, Errors.EMERGENCY_PERIOD_FINISHED);
        _emergencyPeriodActive = active;
        emit EmergencyPeriodChanged(active);
    }

    function _ensureInactiveEmergencyPeriod() internal view {
        _require(_isEmergencyPeriodInactive(), Errors.EMERGENCY_PERIOD_ON);
    }

    function _isEmergencyPeriodInactive() internal view returns (bool) {
        return (block.timestamp >= _emergencyPeriodCheckEndDate) || !_emergencyPeriodActive;
    }
}
