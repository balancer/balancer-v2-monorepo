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
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolIdRegistry.sol";

contract ProtocolIdRegistry is IProtocolIdRegistry, SingletonAuthentication {
    // Asssociate a name with each registered protocol that uses this factory.
    struct ProtocolIdData {
        string name;
        bool registered;
    }

    // Maintain a set of recognized protocolIds.
    mapping(uint256 => ProtocolIdData) private _protocolIds;

    constructor(IVault vault) SingletonAuthentication(vault) {
        _protocolIds[0] = ProtocolIdData({ name: "Aave", registered: true });
    }

    /**
     * @notice Register an id (and name) to differentiate between protocols.
     * @dev This is a permissioned function. Protocol ids cannot be deregistered.
     */
    function registerProtocolId(uint256 protocolId, string memory name) external override authenticate {
        require(!_protocolIds[protocolId].registered, "Protocol ID already registered");

        _registerProtocolId(protocolId, name);
    }

    /**
     * @notice Retrieve the availability of a given protocol id
     * @return bool is protocolId not in use
     */
    function isProtocolIdAvailable(uint256 protocolId) public view returns (bool) {
        return (!_protocolIds[protocolId].registered) ? true : false;
    }

    function _registerProtocolId(uint256 protocolId, string memory name) private {
        _protocolIds[protocolId] = ProtocolIdData({ name: name, registered: true });

        emit ProtocolIdRegistered(protocolId, name);
    }
}
