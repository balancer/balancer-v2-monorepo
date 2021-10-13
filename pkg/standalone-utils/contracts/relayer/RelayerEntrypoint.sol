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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "../interfaces/IRelayerEntrypoint.sol";

/**
 * @title RelayerEntrypoint
 * @notice Allows safe multicall execution of a relayer's functions
 * @dev
 * Relayers are formed out of a system of two contracts:
 *  - This contract which acts as a single point of entry into the system through a multicall function
 *  - A library contract which defines the allowed behaviour of the relayer
 *
 * The relayer entrypoint can then repeatedly delegatecall into the library's code to perform actions.
 * We can then run combinations of the library contract's functions in the context of the relayer entrypoint
 * without having to expose all these functions on the entrypoint contract itself. The multicall function is
 * then a single point of entry for all actions which can be easily protected against reentrancy.
 *
 * This design gives much stronger reentrancy guarantees as otherwise a malicious contract could reenter
 * the relayer through another function (which must allow reentrancy for multicall logic) which would
 * potentially allow them to manipulate global state resulting in loss of funds in some cases.
 * e.g. sweeping any leftover ETH which should have been refunded to the user.
 *
 * NOTE: Only the entrypoint contract should be whitelisted by Balancer governance as a relayer and so the Vault
 * will reject calls made if they are not being run from within the context of the entrypoint.
 * e.g. in the case where a user mistakenly calls into the library contract directly.
 */
contract RelayerEntrypoint is IRelayerEntrypoint, ReentrancyGuard {
    using Address for address payable;
    using Address for address;

    address private immutable _vault;
    address private immutable _library;

    /**
     * @dev This contract is not meant to be deployed directly by an EOA, but rather during construction of a child of
     * `BaseRelayerLibrary` which will provides its own address to be used as the relayer's library.
     */ 
    constructor(IVault vault, address libraryAddress) {
        _vault = address(vault);
        _library = libraryAddress;
    }

    receive() external payable {
        // Accept ETH transfers only coming from the Vault. This is only expected to happen when joining a pool,
        // performing a swap or managing a user's balance does not use the full amount of ETH provided.
        // Any remaining ETH value will be transferred back to this contract and forwarded back to the original sender.
        _require(msg.sender == _vault, Errors.ETH_TRANSFER);
    }

    function getLibrary() external view override returns (address) {
        return _library;
    }

    function multicall(bytes[] calldata data) external payable override nonReentrant returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            results[i] = _library.functionDelegateCall(data[i]);
        }

        _refundETH();
    }

    function _refundETH() private {
        uint256 remainingEth = address(this).balance;
        if (remainingEth > 0) {
            msg.sender.sendValue(remainingEth);
        }
    }
}
