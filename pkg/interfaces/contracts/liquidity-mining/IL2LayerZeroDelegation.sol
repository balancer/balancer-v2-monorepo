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
 * @notice Minimal hook interface to be called whenever the veBAL balance of a user is updated in a L2 chain.
 */
interface IL2LayerZeroDelegation {
    /**
     * @notice Called whenever the veBAL balance of a user is updated in a L2 chain.
     * @param user The user whose veBAL balance was updated.
     */
    function onVeBalBridged(address user) external;

    /**
     * @notice Called whenever the total veBAL supply is updated in a L2 chain.
     */
    function onVeBalSupplyUpdate() external;
}
