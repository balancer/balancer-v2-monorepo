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
import "../interfaces/IBaseRelayerImplementation.sol";

/**
 * @title BaseRelayerImplementation
 * @notice Core functionality of a relayer allowing users to approve it to take further actions using a signature
 */
abstract contract BaseRelayerImplementation is IBaseRelayerImplementation {
    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    function getVault() public view override returns (IVault) {
        return _vault;
    }

    function setRelayerApproval(bool approved, bytes calldata authorisation) external payable {
        bytes memory data = abi.encodePacked(
            abi.encodeWithSelector(_vault.setRelayerApproval.selector, msg.sender, address(this), approved),
            authorisation
        );
        _vaultAction(0, data);
    }

    /**
     * @notice Allows calling an arbitrary function on the Vault
     * @dev To be used only to set relayer approval - other actions should be called with a permanent approval set
     */
    function _vaultAction(uint256 value, bytes memory data) private returns (bytes memory) {
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory result) = address(_vault).call{ value: value }(data);

        // Pass up revert if the call failed
        if (!success) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }

        return result;
    }
}
