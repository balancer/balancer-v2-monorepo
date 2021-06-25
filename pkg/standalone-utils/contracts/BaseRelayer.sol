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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

/**
 * @title BaseRelayer
 * @notice Allows users to atomically approve a relayer and call multiple actions on it
 */
abstract contract BaseRelayer {
    using Address for address payable;

    IVault public immutable vault;

    constructor(IVault _vault) {
        vault = _vault;
    }

    receive() external payable {
        // Accept ETH transfers only coming from the Vault. This is only expected to happen when joining a pool,
        // any remaining ETH value will be transferred back to this contract and forwarded back to the original sender.
        _require(msg.sender == address(vault), Errors.ETH_TRANSFER);
    }

    function setRelayerApproval(
        address relayer,
        bool approved,
        bytes calldata authorisation
    ) external payable {
        bytes memory data = abi.encodePacked(
            abi.encodeWithSelector(vault.setRelayerApproval.selector, msg.sender, relayer, approved),
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
        (bool success, bytes memory result) = address(vault).call{ value: value }(data);

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

    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);

            if (!success) {
                // Next 6 lines from https://ethereum.stackexchange.com/a/83577
                if (result.length < 68) revert("MULTICALL_FAILED");
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    result := add(result, 0x04)
                }
                revert(abi.decode(result, (string)));
            }

            results[i] = result;
        }

        uint256 remainingEth = address(this).balance;
        if (remainingEth > 0) {
            msg.sender.sendValue(remainingEth);
        }
    }
}
