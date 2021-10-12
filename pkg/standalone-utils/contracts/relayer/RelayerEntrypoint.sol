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
 */
contract RelayerEntrypoint is IRelayerEntrypoint, ReentrancyGuard {
    using Address for address payable;

    address private immutable _vault;
    address private immutable _implementation;

    constructor(IVault vault) {
        _vault = address(vault);
        _implementation = msg.sender;
    }

    receive() external payable {
        // Accept ETH transfers only coming from the Vault. This is only expected to happen when joining a pool,
        // performing a swap or managing a user's balance does not use the full amount of ETH provided.
        // Any remaining ETH value will be transferred back to this contract and forwarded back to the original sender.
        _require(msg.sender == _vault, Errors.ETH_TRANSFER);
    }

    function getImplementation() external view returns (address) {
        return _implementation;
    }

    function multicall(bytes[] calldata data) external payable nonReentrant returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory result) = _implementation.delegatecall(data[i]);

            if (!success) {
                // If there's no revert reason, provide our own
                if (result.length < 68) revert("MULTICALL_FAILED");

                // Otherwise, bubble-up the original one
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
            }

            results[i] = result;
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
