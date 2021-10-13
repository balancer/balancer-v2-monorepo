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

import "./BalancerRelayer.sol";
import "../interfaces/IBalancerRelayer.sol";
import "../interfaces/IBaseRelayerLibrary.sol";

/**
 * @title Base Relayer Library
 * @notice Core functionality of a relayer allowing users to approve it to take further actions using a signature
 * @dev
 * Relayers are formed out of a system of two contracts:
 *  - A `BalancerRelayer` contract which acts as a single point of entry into the system through a multicall function
 *  - A library contract such as this which defines the allowed behaviour of the relayer
 *
 * NOTE: Only the entrypoint contract should be whitelisted by Balancer governance as a relayer and so the Vault
 * will reject calls made if they are not being run from within the context of the entrypoint.
 * This contract should neither be whitelisted as a relayer or called directly by any user.
 * No guarantees can be made about fund safety when calling this contract in an improper manner.
 */
contract BaseRelayerLibrary is IBaseRelayerLibrary {
    using Address for address;

    IVault private immutable _vault;
    IBalancerRelayer private immutable _entrypoint;

    // TODO: Do we need to do anything special here?
    // We're going to be using storage slots in the relayer's context
    // but as there's no storage variables there this seems safe.
    mapping(int256 => int256) private _tempStorage;

    constructor(IVault vault) {
        _vault = vault;
        _entrypoint = new BalancerRelayer(vault, address(this));
    }

    function getVault() public view override returns (IVault) {
        return _vault;
    }

    function getEntrypoint() public view returns (IBalancerRelayer) {
        return _entrypoint;
    }

    function _readTempStorage(int256 key) internal override returns (int256 value) {
        value = _tempStorage[key];
        delete _tempStorage[key];
    }

    function _writeTempStorage(int256 key, int256 value) internal override {
        if (key >= 0) return;
        _tempStorage[key] = value;
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
