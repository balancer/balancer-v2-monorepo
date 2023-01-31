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
 * @notice This contract will be the registry where all protocol ids are added and registered
 * Preapproved protocols can be assigned before registration and will go through governance in
 * order to claim a protocol id. These protocol ids will be used accross pool types and will be
 * managed within this contract.
 */
interface IProtocolIdRegistry {
    /**
     * @notice Record protocol ID registrations.
     * @dev Ids that are registered are protocols that have claimed an Id and already have
     * a live pool deployed with said Id
     * @param protocolId
     * @param name of protocol
     */
    event ProtocolIdRegistered(uint256 indexed protocolId, string name);

    /**
     * @notice Register an id (and name) to differentiate between protocols.
     * @dev This is a permissioned function. Protocol ids cannot be deregistered.
     */
    function registerProtocolId(uint256 protocolId, string memory name) external;
}
