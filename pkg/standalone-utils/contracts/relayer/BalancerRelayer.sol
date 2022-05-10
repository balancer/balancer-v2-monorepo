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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";

/**
 * @title Balancer Relayer
 * @notice Allows safe multicall execution of a relayer's functions
 * @dev
 * Relayers are composed of two contracts:
 *  - This contract, which acts as a single point of entry into the system through a multicall function.
 *  - A library contract, which defines the allowed behaviour of the relayer.
 *
 * The relayer entrypoint can then repeatedly delegatecall into the library's code to perform actions.
 * We can then run combinations of the library contract's functions in the context of the relayer entrypoint,
 * without having to expose all these functions on the entrypoint contract itself. The multicall function is
 * then a single point of entry for all actions, so we can easily prevent reentrancy.
 *
 * This design gives much stronger reentrancy guarantees, as otherwise a malicious contract could reenter
 * the relayer through another function (which must allow reentrancy for multicall logic), and that would
 * potentially allow them to manipulate global state, resulting in loss of funds in some cases:
 * e.g., sweeping any leftover ETH that should have been refunded to the user.
 *
 * NOTE: Only the entrypoint contract should be allowlisted by Balancer governance as a relayer, so that the
 * Vault will reject calls from outside the context of the entrypoint: e.g., if a user mistakenly called directly
 * into the library contract.
 */
contract BalancerRelayer is IBalancerRelayer, ReentrancyGuard {
    using Address for address payable;
    using Address for address;

    IVault private immutable _vault;
    address private immutable _library;

    /**
     * @dev This contract is not meant to be deployed directly by an EOA, but rather during construction of a contract
     * derived from `BaseRelayerLibrary`, which will provide its own address as the relayer's library.
     */
    constructor(IVault vault, address libraryAddress) {
        _vault = vault;
        _library = libraryAddress;
    }

    receive() external payable {
        // Only accept ETH transfers from the Vault. This is expected to happen due to a swap/exit/withdrawal
        // with ETH as an output, should the relayer be listed as the recipient. This may also happen when
        // joining a pool, performing a swap, or if managing a user's balance uses less than the full ETH value
        // provided. Any excess ETH will be refunded to this contract, and then forwarded to the original sender.
        _require(msg.sender == address(_vault), Errors.ETH_TRANSFER);
    }

    function getVault() external view override returns (IVault) {
        return _vault;
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
