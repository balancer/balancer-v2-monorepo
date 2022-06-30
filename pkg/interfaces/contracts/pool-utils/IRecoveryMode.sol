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
 * @dev Interface for the RecoveryMode helper.
 */
interface IRecoveryMode {
    /**
     * @dev Emitted every time the recovery mode changes through `_setRecoveryMode`.
     */
    event RecoveryModeStateChanged(bool enabled);

    /**
     * @notice Return whether the pool is in recovery mode.
     */
    function inRecoveryMode() external view returns (bool);
}
