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

pragma solidity >=0.7.0 <0.9.0;

/**
 * @notice Simple interface to retrieve the version of pools deployed by a pool factory.
 */
interface IPoolVersion {
    /**
     * @dev Returns a JSON representation of the deployed pool version containing name, version number and task ID.
     *
     * This is typically only useful in complex Pool deployment schemes, where multiple subsystems need to know about
     * each other. Note that this value will only be updated at factory creation time.
     */
    function getPoolVersion() external view returns (string memory);
}
