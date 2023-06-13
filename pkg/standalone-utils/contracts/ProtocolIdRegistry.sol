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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolIdRegistry.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";

contract ProtocolIdRegistry is IProtocolIdRegistry, SingletonAuthentication {
    struct ProtocolIdData {
        string name;
        bool registered;
    }

    mapping(uint256 => ProtocolIdData) private _protocolIdData;

    modifier withValidProtocolId(uint256 protocolId) {
        require(isValidProtocolId(protocolId), "Non-existent protocol ID");
        _;
    }

    constructor(IVault vault) SingletonAuthentication(vault) {
        _registerProtocolId(ProtocolId.AAVE_V1, "Aave v1");
        _registerProtocolId(ProtocolId.AAVE_V2, "Aave v2");
        _registerProtocolId(ProtocolId.AAVE_V3, "Aave v3");
        _registerProtocolId(ProtocolId.AMPLEFORTH, "Ampleforth");
        _registerProtocolId(ProtocolId.BEEFY, "Beefy");
        _registerProtocolId(ProtocolId.EULER, "Euler");
        _registerProtocolId(ProtocolId.GEARBOX, "Gearbox");
        _registerProtocolId(ProtocolId.IDLE, "Idle");
        _registerProtocolId(ProtocolId.MORPHO, "Morpho");
        _registerProtocolId(ProtocolId.RADIANT, "Radiant");
        _registerProtocolId(ProtocolId.REAPER, "Reaper");
        _registerProtocolId(ProtocolId.SILO, "Silo");
        _registerProtocolId(ProtocolId.STARGATE, "Stargate");
        _registerProtocolId(ProtocolId.STURDY, "Sturdy");
        _registerProtocolId(ProtocolId.TESSERA, "Tessera");
        _registerProtocolId(ProtocolId.TETU, "Tetu");
        _registerProtocolId(ProtocolId.YEARN, "Yearn");
        _registerProtocolId(ProtocolId.MIDAS, "Midas");
        _registerProtocolId(ProtocolId.AGAVE, "Agave");
    }

    /// @inheritdoc IProtocolIdRegistry
    function registerProtocolId(uint256 protocolId, string memory name) external override authenticate {
        _registerProtocolId(protocolId, name);
    }

    /// @inheritdoc IProtocolIdRegistry
    function renameProtocolId(uint256 protocolId, string memory newName) external override authenticate {
        _renameProtocolId(protocolId, newName);
    }

    /// @inheritdoc IProtocolIdRegistry
    function isValidProtocolId(uint256 protocolId) public view override returns (bool) {
        return _protocolIdData[protocolId].registered;
    }

    function _registerProtocolId(uint256 protocolId, string memory name) private {
        require(!isValidProtocolId(protocolId), "Protocol ID already registered");
        _protocolIdData[protocolId] = ProtocolIdData({ name: name, registered: true });
        emit ProtocolIdRegistered(protocolId, name);
    }

    function _renameProtocolId(uint256 protocolId, string memory newName) private {
        require(isValidProtocolId(protocolId), "Protocol ID not registered");
        _protocolIdData[protocolId].name = newName;
        emit ProtocolIdRenamed(protocolId, newName);
    }

    /// @inheritdoc IProtocolIdRegistry
    function getProtocolName(uint256 protocolId)
        external
        view
        override
        withValidProtocolId(protocolId)
        returns (string memory)
    {
        return _protocolIdData[protocolId].name;
    }
}
