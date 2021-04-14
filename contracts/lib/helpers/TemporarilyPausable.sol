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
 * @dev Provide "Emergency Stop" functionality that allows pausing a contract during an emergency.
 *
 * The Response Window begins at contract deployment: the contract can only be paused during this time period.
 *
 * If the contract is paused when the Response Window end time passes, it will remain in the paused state through
 * an additional Buffer Period, after which it will be automatically unpaused forever. This is to ensure there is
 * enough time to react to the emergency, even if the threat is discovered shortly before the Response Window expires.
 *
 * The contract may be unpaused at any time before the end of the Buffer Period. This is a safety measure:
 * it lets the emergency managers react quickly to potentially dangerous situations, knowing that this action is
 * reversible if careful analysis determines there was a false alarm. Note that since the contract can only be paused
 * within the Response Window, unpausing during the Buffer Period is irrevocable.
 */
abstract contract TemporarilyPausable {
    // This contract uses timestamps
    // solhint-disable not-rely-on-time

    uint256 private constant _MAX_RESPONSE_WINDOW_DURATION = 90 days;
    uint256 private constant _MAX_BUFFER_PERIOD_DURATION = 30 days;

    uint256 private immutable _responseWindowEndTime;
    uint256 private immutable _bufferPeriodEndTime;

    bool private _paused;

    event PausedStateChanged(bool paused);

    modifier whenNotPaused() {
        _ensureNotPaused();
        _;
    }

    constructor(uint256 responseWindowDuration, uint256 bufferPeriodDuration) {
        _require(responseWindowDuration <= _MAX_RESPONSE_WINDOW_DURATION, Errors.MAX_RESPONSE_WINDOW_DURATION);
        _require(bufferPeriodDuration <= _MAX_BUFFER_PERIOD_DURATION, Errors.MAX_BUFFER_PERIOD_DURATION);

        uint256 responseWindowEndTime = block.timestamp + responseWindowDuration;

        _responseWindowEndTime = responseWindowEndTime;
        _bufferPeriodEndTime = responseWindowEndTime + bufferPeriodDuration;
    }

    function getPausedState()
        external
        view
        returns (
            bool paused,
            uint256 responseWindowEndTime,
            uint256 bufferPeriodEndTime
        )
    {
        paused = _isPaused();
        responseWindowEndTime = _getResponseWindowEndTime();
        bufferPeriodEndTime = _getBufferPeriodEndTime();
    }

    // The contract can only be paused during the initial response window. It can be unpaused at
    // any time through the end of the buffer period.
    //
    // Regardless of the final state of the flag, the contract is considered permanently unpaused
    // after the buffer period expires. It is then fully functional and trustless.
    function _setPaused(bool paused) internal {
        uint256 endTime = paused ? _getResponseWindowEndTime() : _getBufferPeriodEndTime();

        _require(block.timestamp < endTime, Errors.EMERGENCY_WINDOW_EXPIRED);

        _paused = paused;

        emit PausedStateChanged(paused);
    }

    function _ensureNotPaused() internal view {
        _require(!_isPaused(), Errors.PAUSED);
    }

    function _isPaused() internal view returns (bool) {
        return (_paused && block.timestamp < _getBufferPeriodEndTime());
    }

    function _getResponseWindowEndTime() internal view returns (uint256) {
        return _responseWindowEndTime;
    }

    function _getBufferPeriodEndTime() internal view returns (uint256) {
        return _bufferPeriodEndTime;
    }
}
