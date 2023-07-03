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

import "./relayer/BaseRelayerLibrary.sol";

import "./relayer/AaveWrapping.sol";
import "./relayer/ERC4626Wrapping.sol";
import "./relayer/EulerWrapping.sol";
import "./relayer/GaugeActions.sol";
import "./relayer/GearboxWrapping.sol";
import "./relayer/LidoWrapping.sol";
import "./relayer/CompoundV2Wrapping.sol";
import "./relayer/UnbuttonWrapping.sol";
import "./relayer/ReaperWrapping.sol";
import "./relayer/TetuWrapping.sol";
import "./relayer/SiloWrapping.sol";
import "./relayer/VaultActions.sol";
import "./relayer/VaultPermit.sol";
import "./relayer/YearnWrapping.sol";

/**
 * @title Batch Relayer Library
 * @notice This contract is not a relayer by itself and calls into it directly will fail.
 * The associated relayer can be found by calling `getEntrypoint` on this contract.
 */
contract BatchRelayerLibrary is
    AaveWrapping,
    BaseRelayerLibrary,
    ERC4626Wrapping,
    EulerWrapping,
    GaugeActions,
    GearboxWrapping,
    LidoWrapping,
    UnbuttonWrapping,
    CompoundV2Wrapping,
    ReaperWrapping,
    SiloWrapping,
    TetuWrapping,
    VaultActions,
    VaultPermit,
    YearnWrapping
{
    constructor(
        IVault vault,
        IERC20 wstETH,
        IBalancerMinter minter,
        bool canCallUserCheckpoint,
        string memory version
    ) BaseRelayerLibrary(vault, version) LidoWrapping(wstETH) GaugeActions(minter, canCallUserCheckpoint) {
        // solhint-disable-previous-line no-empty-blocks
    }
}
