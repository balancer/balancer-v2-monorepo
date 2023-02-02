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
        _registerProtocolId(ProtocolId.AURA, "Aura");
        _registerProtocolId(ProtocolId.BEEFY, "Beefy");
        _registerProtocolId(ProtocolId.BEETHOVEN, "Beethoven X");
        _registerProtocolId(ProtocolId.BUTTONWOOD, "Buttonwood");
        _registerProtocolId(ProtocolId.COW, "CoW Protocol");
        _registerProtocolId(ProtocolId.CRON, "Cron");
        _registerProtocolId(ProtocolId.ELEMENT, "Element");
        _registerProtocolId(ProtocolId.EULER, "Euler");
        _registerProtocolId(ProtocolId.FJORD, "Fjord");
        _registerProtocolId(ProtocolId.GEARBOX, "Gearbox");
        _registerProtocolId(ProtocolId.GYROSCOPE, "Gyroscope");
        _registerProtocolId(ProtocolId.ONEINCH, "1inch");
        _registerProtocolId(ProtocolId.MYCELIUM, "Mycelium");
        _registerProtocolId(ProtocolId.PARASWAP, "ParaSwap");
        _registerProtocolId(ProtocolId.POWERPOOL, "PowerPool");
        _registerProtocolId(ProtocolId.PRIMEDAO, "PrimeDAO");
        _registerProtocolId(ProtocolId.REAPER, "Reaper");
        _registerProtocolId(ProtocolId.SENSE, "Sense");
        _registerProtocolId(ProtocolId.SILO, "Silo");
        _registerProtocolId(ProtocolId.STAKEDAO, "StakeDAO");
        _registerProtocolId(ProtocolId.STARGATE, "Stargate");
        _registerProtocolId(ProtocolId.TETU, "Tetu");
        _registerProtocolId(ProtocolId.TEMPUS, "Tempus");
        _registerProtocolId(ProtocolId.XAVE, "Xave");
        _registerProtocolId(ProtocolId.YEARN, "Yearn");
    }

    /// @inheritdoc IProtocolIdRegistry
    function registerProtocolId(uint256 protocolId, string memory name) external override authenticate {
        require(!_protocolIdData[protocolId].registered, "Protocol ID already registered");
        _registerProtocolId(protocolId, name);
    }

    /// @inheritdoc IProtocolIdRegistry
    function isValidProtocolId(uint256 protocolId) public view override returns (bool) {
        return _protocolIdData[protocolId].registered;
    }

    function _registerProtocolId(uint256 protocolId, string memory name) private {
        _protocolIdData[protocolId] = ProtocolIdData({ name: name, registered: true });
        emit ProtocolIdRegistered(protocolId, name);
    }

    /// @inheritdoc IProtocolIdRegistry
    function getProtocolName(
        uint256 protocolId
    ) external view override withValidProtocolId(protocolId) returns (string memory) {
        return _protocolIdData[protocolId].name;
    }
}
