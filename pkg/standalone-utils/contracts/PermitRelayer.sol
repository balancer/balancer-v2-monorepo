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
import "./base/MultiDelegatecall.sol";

/**
 * @title PermitRelayer
 * @notice Allows users to atomically perform multiple Balancer Vault actions in sequence
 * including token approvals using permit (where supported)
 */
contract PermitRelayer is MultiDelegatecall {
    IVault public immutable vault;

    constructor(IVault _vault) {
        vault = _vault;
    }

    /**
     * @notice Allows calling an arbitrary function on the Vault
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

    function setRelayerApproval(
        address relayer,
        bool approved,
        bytes calldata authorisation
    ) external payable {
        bytes memory data =
            abi.encodePacked(
                abi.encodeWithSelector(vault.setRelayerApproval.selector, msg.sender, relayer, approved),
                authorisation
            );
        _vaultAction(0, data);
    }

    function swap(
        IVault.SingleSwap calldata singleSwap,
        IVault.FundManagement calldata funds,
        uint256 limit,
        uint256 deadline,
        uint256 value
    ) external payable returns (uint256) {
        require(funds.sender == msg.sender, "Incorrect sender");
        return vault.swap{ value: value }(singleSwap, funds, limit, deadline);
    }

    function batchSwap(
        IVault.SwapKind kind,
        IVault.BatchSwapStep[] calldata swaps,
        IAsset[] calldata assets,
        IVault.FundManagement calldata funds,
        int256[] calldata limits,
        uint256 deadline,
        uint256 value
    ) external payable returns (int256[] memory) {
        require(funds.sender == msg.sender, "Incorrect sender");
        return vault.batchSwap{ value: value }(kind, swaps, assets, funds, limits, deadline);
    }

    function manageUserBalance(
        IVault.UserBalanceOp[] calldata ops,
        uint256 value
    ) external payable {
        for (uint256 i = 0; i < ops.length; i++){
            require(ops[i].sender == msg.sender, "Incorrect sender");
        }
        vault.manageUserBalance{ value: value }(ops);
    }

    function joinPool(
        bytes32 poolId,
        address recipient,
        IVault.JoinPoolRequest calldata request,
        uint256 value
    ) external payable {
        vault.joinPool{ value: value }(poolId, msg.sender, recipient, request);
    }

    function exitPool(
        bytes32 poolId,
        address payable recipient,
        IVault.ExitPoolRequest calldata request
    ) external payable {
        vault.exitPool(poolId, msg.sender, recipient, request);
    }

    /**
     * @dev Used to receive refunds from the Vault
     */
    receive() external payable {
        // solhint-disable-previous-line no-empty-blocks
    }

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
        token.permit(msg.sender, address(vault), value, deadline, v, r, s);
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
        token.permit(msg.sender, address(vault), nonce, expiry, allowed, v, r, s);
    }
}
