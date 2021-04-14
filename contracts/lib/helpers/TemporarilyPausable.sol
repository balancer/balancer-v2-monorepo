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
 * @dev Provide "Emergency Stop" functionality that allows pausing a contract: for example, the Vault, or a Pool.
 *
 * The Emergency Response Window end date is initialized on creation, and cannot be set longer than _MAX_RESPONSE_WINDOW
 * days in the future. During this period, `setPausedState` can be called to set the `_paused` state variable.
 *
 * If the contract is paused when the end date passes (and it is not deliberately unpaused), it will remain in the
 * paused state through an additional Buffer Period, after which it will be automatically deactivated forever.
 * This additional time period is also set on creation, and is limited to _MAX_BUFFER_PERIOD days. This is designed
 * to provide enough time to react to the emergency, even if it is discovered shortly before the Response Window is
 * set to expire.
 *
 * The contract may be unpaused at any time before the end of the Buffer Period. This is a safety measure: it lets
 * the emergency managers react quickly to potentially dangerous situations, knowing that this action is reversible
 * if careful analysis determines it was a false alarm.
 */
abstract contract TemporarilyPausable {
    // This contract uses timestamps
    // solhint-disable not-rely-on-time

    uint256 private constant _MAX_RESPONSE_WINDOW = 90 days;
    uint256 private constant _MAX_BUFFER_PERIOD = 30 days;

    uint256 private immutable _responseWindowEndDate;
    uint256 private immutable _bufferPeriodEndDate;

    bool private _paused;

    event PausedStateChanged(bool paused);

    modifier whenNotPaused() {
        _ensureNotPaused();
        _;
    }

    constructor(uint256 responseWindow, uint256 bufferPeriod) {
        _require(responseWindow <= _MAX_RESPONSE_WINDOW, Errors.MAX_RESPONSE_WINDOW);
        _require(bufferPeriod <= _MAX_BUFFER_PERIOD, Errors.MAX_BUFFER_PERIOD);

        uint256 timestamp = block.timestamp;

        _responseWindowEndDate = timestamp + responseWindow;
        _bufferPeriodEndDate = timestamp + responseWindow + bufferPeriod;
    }

    function getPausedState()
        external
        view
        returns (
            bool paused,
            uint256 responseWindowEndDate,
            uint256 bufferPeriodEndDate
        )
    {
        paused = _isPaused();
        responseWindowEndDate = _getResponseWindowEndDate();
        bufferPeriodEndDate = _getBufferPeriodEndDate();
    }

    // The contract can only be paused during the initial response window. It can be unpaused at
    // any time through the end of the buffer period.
    //
    // Regardless of the final state of the flag, the contract is considered permanently unpaused
    // after the buffer period expires. It is then fully functional and trustless.
    function _setPausedState(bool paused) internal {
        uint256 endDate = paused ? _getResponseWindowEndDate() : _getBufferPeriodEndDate();

        _require(block.timestamp < endDate, Errors.EMERGENCY_WINDOW_EXPIRED);

        _paused = paused;

        emit PausedStateChanged(paused);
    }

    function _ensureNotPaused() internal view {
        _require(!_isPaused(), Errors.PAUSED);
    }

    function _isPaused() internal view returns (bool) {
        return (_paused && block.timestamp < _getBufferPeriodEndDate());
    }

    function _getResponseWindowEndDate() internal view returns (uint256) {
        return _responseWindowEndDate;
    }

    function _getBufferPeriodEndDate() internal view returns (uint256) {
        return _bufferPeriodEndDate;
    }
}
