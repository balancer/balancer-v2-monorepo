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
 * @dev Define constants for the maximum initial pause window and buffer period durations.
 * These are checked in `TemporarilyPausable` on pool deployment, and also in `BasePoolFactory`
 * on factory deployment, to ensure that all factories can create pools.
 *
 * Note that in solidity 0.8, these could be defined outside the contract, in file scope
 * (e.g., in ITemporarilyPausable).
 */
abstract contract PausableConstants {
    uint256 private constant _MAX_PAUSE_WINDOW_DURATION = 270 days;
    uint256 private constant _MAX_BUFFER_PERIOD_DURATION = 90 days;

    function MAX_PAUSE_WINDOW_DURATION() public pure returns (uint256) {
        return _MAX_PAUSE_WINDOW_DURATION;
    }

    function MAX_BUFFER_PERIOD_DURATION() public pure returns (uint256) {
        return _MAX_BUFFER_PERIOD_DURATION;
    }
}
