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

import "./relayer/BaseRelayerLibraryCommon.sol";

import "./relayer/VaultQueryActions.sol";

/**
 * @title Batch Relayer Library
 * @notice This contract is not a relayer by itself and calls into it directly will fail.
 * The associated relayer can be found by calling `getEntrypoint` on this contract.
 */
contract BatchRelayerQueryLibrary is BaseRelayerLibraryCommon, VaultQueryActions {
    constructor(IVault vault) BaseRelayerLibraryCommon(vault) {
        //solhint-disable-previous-line no-empty-blocks
    }
}
