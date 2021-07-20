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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20Permit.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20PermitDAI.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "../interfaces/IBaseRelayerImplementation.sol";

/**
 * @title VaultPermit
 * @notice Allows users to atomically perform multiple Balancer Vault actions in sequence
 * including token approvals using permit (where supported)
 */
abstract contract VaultPermit is IBaseRelayerImplementation {
    /**
     * @dev Must be payable so that it can be called as part of a multicall involving ETH
     */
    function vaultPermit(
        IERC20Permit token,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public payable {
        token.permit(msg.sender, address(getVault()), value, deadline, v, r, s);
    }

    /**
     * @dev Must be payable so that it can be called as part of a multicall involving ETH
     */
    function vaultPermitDAI(
        IERC20PermitDAI token,
        uint256 nonce,
        uint256 expiry,
        bool allowed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public payable {
        token.permit(msg.sender, address(getVault()), nonce, expiry, allowed, v, r, s);
    }
}
