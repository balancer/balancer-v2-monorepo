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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20Permit.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20PermitDAI.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "../interfaces/IBaseRelayerLibrary.sol";

/**
 * @title VaultActions
 * @notice Allows users to call the core functions on the Balancer Vault (swaps/joins/exits/balance management)
 * @dev
 * The relayer is not expected to hold the user's funds so it is expected that the user's address will be provided
 * as the recipient of any token transfers from the Vault.
 *
 * All functions must be payable so that it can be called as part of a multicall involving ETH
 */
abstract contract VaultActions is IBaseRelayerLibrary {
    function swap(
        IVault.SingleSwap memory singleSwap,
        IVault.FundManagement calldata funds,
        uint256 limit,
        uint256 deadline,
        uint256 value,
        uint256 outputReference
    ) external payable returns (uint256) {
        require(funds.sender == msg.sender, "Incorrect sender");

        if (_isChainedReference(singleSwap.amount)) {
            singleSwap.amount = _getChainedReferenceValue(singleSwap.amount);
        }

        uint256 result = getVault().swap{ value: value }(singleSwap, funds, limit, deadline);

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, result);
        }

        return result;
    }

    function batchSwap(
        IVault.SwapKind kind,
        IVault.BatchSwapStep[] memory swaps,
        IAsset[] calldata assets,
        IVault.FundManagement calldata funds,
        int256[] calldata limits,
        uint256 deadline,
        uint256 value,
        uint256[] memory outputReferences
    ) external payable returns (int256[] memory) {
        require(funds.sender == msg.sender, "Incorrect sender");
        InputHelpers.ensureInputLengthMatch(assets.length, outputReferences.length);

        for (uint256 i = 0; i < swaps.length; ++i) {
            uint256 amount = swaps[i].amount;
            if (_isChainedReference(amount)) {
                swaps[i].amount = _getChainedReferenceValue(amount);
            }
        }

        int256[] memory results = getVault().batchSwap{ value: value }(kind, swaps, assets, funds, limits, deadline);

        for (uint256 i = 0; i < outputReferences.length; ++i) {
            uint256 ref = outputReferences[i];
            if (_isChainedReference(ref)) {
                // Batch swap return values are signed, as they are Vault deltas (positive values stand for assets sent
                // to the Vault, negatives for assets sent from the Vault). To simplify the chained reference value
                // model, we simply store the absolute value.
                // This should be fine for most use cases, as the caller can reason about swap results via the `limits`
                // parameter.
                _setChainedReferenceValue(ref, Math.abs(results[i]));
            }
        }

        return results;
    }

    function manageUserBalance(IVault.UserBalanceOp[] calldata ops, uint256 value) external payable {
        for (uint256 i = 0; i < ops.length; i++) {
            require(ops[i].sender == msg.sender, "Incorrect sender");
        }
        getVault().manageUserBalance{ value: value }(ops);
    }

    function joinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.JoinPoolRequest calldata request,
        uint256 value
    ) external payable {
        require(sender == msg.sender, "Incorrect sender");
        getVault().joinPool{ value: value }(poolId, sender, recipient, request);
    }

    function exitPool(
        bytes32 poolId,
        address sender,
        address payable recipient,
        IVault.ExitPoolRequest calldata request
    ) external payable {
        require(sender == msg.sender, "Incorrect sender");
        getVault().exitPool(poolId, sender, recipient, request);
    }
}
