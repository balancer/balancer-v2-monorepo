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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IBalancerRelayer.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "./IBaseRelayerLibrary.sol";
import "../BatchRelayerQueryLibrary.sol";
import "./BalancerRelayer.sol";

/**
 * @title Base Relayer Library
 * @notice Core functionality of a relayer. Allow users to use a signature to approve this contract
 * to take further actions on their behalf.
 * @dev
 * Relayers are composed of two contracts:
 *  - A `BalancerRelayer` contract, which acts as a single point of entry into the system through a multicall function
 *  - A library contract such as this one, which defines the allowed behaviour of the relayer

 * NOTE: Only the entrypoint contract should be allowlisted by Balancer governance as a relayer, so that the Vault
 * will reject calls from outside the entrypoint context.
 *
 * This contract should neither be allowlisted as a relayer, nor called directly by the user.
 * No guarantees can be made about fund safety when calling this contract in an improper manner.
 *
 * All functions that are meant to be called from the entrypoint via `multicall` must be payable so that they
 * do not revert in a call involving ETH. This also applies to functions that do not alter the state and would be
 * usually labeled as `view`.
 */
contract BaseRelayerLibrary is BaseRelayerLibraryCommon {
    using Address for address;
    using SafeERC20 for IERC20;

    IVault private immutable _vault;
    IBalancerRelayer private immutable _entrypoint;

    constructor(IVault vault, string memory version) BaseRelayerLibraryCommon(vault) {
        _vault = vault;

        IBaseRelayerLibrary queryLibrary = new BatchRelayerQueryLibrary(vault);

        _entrypoint = new BalancerRelayer(vault, address(this), address(queryLibrary), version);
    }

    function getEntrypoint() external view returns (IBalancerRelayer) {
        return _entrypoint;
    }

    /**
     * @notice Sets whether a particular relayer is authorised to act on behalf of the user
     */
    function setRelayerApproval(
        address relayer,
        bool approved,
        bytes calldata authorisation
    ) external payable {
        require(relayer == address(this) || !approved, "Relayer can only approve itself");
        bytes memory data = abi.encodePacked(
            abi.encodeWithSelector(_vault.setRelayerApproval.selector, msg.sender, relayer, approved),
            authorisation
        );

        address(_vault).functionCall(data);
    }
}
