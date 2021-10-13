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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "./RelayerEntrypoint.sol";
import "../interfaces/IBaseRelayerImplementation.sol";

/**
 * @title BaseRelayerImplementation
 * @notice Core functionality of a relayer allowing users to approve it to take further actions using a signature
 */
contract BaseRelayerImplementation is IBaseRelayerImplementation {
    using Address for address;

    IVault private immutable _vault;
    address private immutable _entrypoint;

    constructor(IVault vault) {
        _vault = vault;
        _entrypoint = address(new RelayerEntrypoint(vault));
    }

    function getVault() public view override returns (IVault) {
        return _vault;
    }

    function getEntrypoint() public view returns (address) {
        return _entrypoint;
    }

    /**
     * @notice Sets whether this relayer is authorised to act on behalf of the user
     */
    function setRelayerApproval(bool approved, bytes calldata authorisation) external payable {
        bytes memory data = abi.encodePacked(
            abi.encodeWithSelector(_vault.setRelayerApproval.selector, msg.sender, address(this), approved),
            authorisation
        );

        address(_vault).functionCall(data);
    }
}
