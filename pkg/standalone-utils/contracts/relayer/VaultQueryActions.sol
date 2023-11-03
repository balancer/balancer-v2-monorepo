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

import "@balancer-labs/v2-interfaces/contracts/vault/IBasePool.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";

import "./VaultActions.sol";

/**
 * @title VaultQueryActions
 * @notice Allows users to simulate the core functions on the Balancer Vault (swaps/joins/exits), using queries instead
 * of the actual operations.
 * @dev Inherits from VaultActions to maximize reuse - but also pulls in `manageUserBalance`. This might not hurt
 * anything, but isn't intended behavior in a query context, so we override and disable it. Anything else added to the
 * base contract that isn't query-friendly should likewise be disabled.
 */
abstract contract VaultQueryActions is VaultActions {
    function swap(
        IVault.SingleSwap memory singleSwap,
        IVault.FundManagement calldata funds,
        uint256 limit,
        uint256, // deadline
        uint256, // value
        uint256 outputReference
    ) external payable override returns (uint256 result) {
        require(funds.sender == msg.sender || funds.sender == address(this), "Incorrect sender");

        if (_isChainedReference(singleSwap.amount)) {
            singleSwap.amount = _getChainedReferenceValue(singleSwap.amount);
        }

        result = _querySwap(singleSwap, funds);

        _require(singleSwap.kind == IVault.SwapKind.GIVEN_IN ? result >= limit : result <= limit, Errors.SWAP_LIMIT);

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, result);
        }
    }

    function _querySwap(IVault.SingleSwap memory singleSwap, IVault.FundManagement memory funds)
        private
        returns (uint256)
    {
        // The Vault only supports batch swap queries, so we need to convert the swap call into an equivalent batch
        // swap. The result will be identical.

        // The main difference between swaps and batch swaps is that batch swaps require an assets array. We're going
        // to place the asset in at index 0, and asset out at index 1.
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = singleSwap.assetIn;
        assets[1] = singleSwap.assetOut;

        IVault.BatchSwapStep[] memory swaps = new IVault.BatchSwapStep[](1);
        swaps[0] = IVault.BatchSwapStep({
            poolId: singleSwap.poolId,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: singleSwap.amount,
            userData: singleSwap.userData
        });

        int256[] memory assetDeltas = getVault().queryBatchSwap(singleSwap.kind, swaps, assets, funds);

        // Batch swaps return the full Vault asset deltas, which in the special case of a single step swap contains more
        // information than we need (as the amount in is known in a GIVEN_IN swap, and the amount out is known in a
        // GIVEN_OUT swap). We extract the information we're interested in.
        if (singleSwap.kind == IVault.SwapKind.GIVEN_IN) {
            // The asset out will have a negative Vault delta (the assets are coming out of the Pool and the user is
            // receiving them), so make it positive to match the `swap` interface.

            _require(assetDeltas[1] <= 0, Errors.SHOULD_NOT_HAPPEN);
            return uint256(-assetDeltas[1]);
        } else {
            // The asset in will have a positive Vault delta (the assets are going into the Pool and the user is
            // sending them), so we don't need to do anything.
            return uint256(assetDeltas[0]);
        }
    }

    function batchSwap(
        IVault.SwapKind kind,
        IVault.BatchSwapStep[] memory swaps,
        IAsset[] calldata assets,
        IVault.FundManagement calldata funds,
        int256[] calldata limits,
        uint256, // deadline
        uint256, // value
        OutputReference[] calldata outputReferences
    ) external payable override returns (int256[] memory results) {
        require(funds.sender == msg.sender || funds.sender == address(this), "Incorrect sender");

        for (uint256 i = 0; i < swaps.length; ++i) {
            uint256 amount = swaps[i].amount;
            if (_isChainedReference(amount)) {
                swaps[i].amount = _getChainedReferenceValue(amount);
            }
        }

        results = getVault().queryBatchSwap(kind, swaps, assets, funds);

        for (uint256 i = 0; i < outputReferences.length; ++i) {
            require(_isChainedReference(outputReferences[i].key), "invalid chained reference");

            _require(results[i] <= limits[i], Errors.SWAP_LIMIT);

            // Batch swap return values are signed, as they are Vault deltas (positive values correspond to assets sent
            // to the Vault, and negative values are assets received from the Vault). To simplify the chained reference
            // value model, we simply store the absolute value.
            // This should be fine for most use cases, as the caller can reason about swap results via the `limits`
            // parameter.
            _setChainedReferenceValue(outputReferences[i].key, Math.abs(results[outputReferences[i].index]));
        }
    }

    function joinPool(
        bytes32 poolId,
        PoolKind kind,
        address sender,
        address recipient,
        IVault.JoinPoolRequest memory request,
        uint256, // value
        uint256 outputReference
    ) external payable override {
        require(sender == msg.sender || sender == address(this), "Incorrect sender");

        request.userData = _doJoinPoolChainedReferenceReplacements(kind, request.userData);

        uint256 bptOut = _queryJoin(poolId, sender, recipient, request);

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, bptOut);
        }
    }

    function _queryJoin(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.JoinPoolRequest memory request
    ) private returns (uint256 bptOut) {
        (address pool, ) = getVault().getPool(poolId);
        (uint256[] memory balances, uint256 lastChangeBlock) = _validateAssetsAndGetBalances(poolId, request.assets);
        IProtocolFeesCollector feesCollector = getVault().getProtocolFeesCollector();

        (bptOut, ) = IBasePool(pool).queryJoin(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            feesCollector.getSwapFeePercentage(),
            request.userData
        );
    }

    function exitPool(
        bytes32 poolId,
        PoolKind kind,
        address sender,
        address payable recipient,
        IVault.ExitPoolRequest memory request,
        OutputReference[] calldata outputReferences
    ) external payable override {
        require(sender == msg.sender || sender == address(this), "Incorrect sender");

        // Exit the Pool
        request.userData = _doExitPoolChainedReferenceReplacements(kind, request.userData);

        uint256[] memory amountsOut = _queryExit(poolId, sender, recipient, request);

        // Save as chained references
        for (uint256 i = 0; i < outputReferences.length; i++) {
            _setChainedReferenceValue(outputReferences[i].key, amountsOut[outputReferences[i].index]);
        }
    }

    function _queryExit(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.ExitPoolRequest memory request
    ) private returns (uint256[] memory amountsOut) {
        (address pool, ) = getVault().getPool(poolId);
        (uint256[] memory balances, uint256 lastChangeBlock) = _validateAssetsAndGetBalances(poolId, request.assets);
        IProtocolFeesCollector feesCollector = getVault().getProtocolFeesCollector();

        (, amountsOut) = IBasePool(pool).queryExit(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            feesCollector.getSwapFeePercentage(),
            request.userData
        );
    }

    function _validateAssetsAndGetBalances(bytes32 poolId, IAsset[] memory expectedAssets)
        private
        view
        returns (uint256[] memory balances, uint256 lastChangeBlock)
    {
        IERC20[] memory actualTokens;
        IERC20[] memory expectedTokens = _translateToIERC20(expectedAssets);

        (actualTokens, balances, lastChangeBlock) = getVault().getPoolTokens(poolId);
        InputHelpers.ensureInputLengthMatch(actualTokens.length, expectedTokens.length);

        for (uint256 i = 0; i < actualTokens.length; ++i) {
            IERC20 token = actualTokens[i];
            _require(token == expectedTokens[i], Errors.TOKENS_MISMATCH);
        }
    }

    /// @dev Prevent `vaultActionsQueryMulticall` from calling manageUserBalance.
    function manageUserBalance(
        IVault.UserBalanceOp[] memory,
        uint256,
        OutputReference[] calldata
    ) external payable override {
        _revert(Errors.UNIMPLEMENTED);
    }
}
