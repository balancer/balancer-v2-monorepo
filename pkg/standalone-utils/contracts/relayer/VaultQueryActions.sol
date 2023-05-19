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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-stable/StablePoolUserData.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IBasePool.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/VaultHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title VaultActions
 * @notice Allows users to simulate the core functions on the Balancer Vault (swaps/joins/exits), using queries instead
 * of the actual operations.
 */
abstract contract VaultQueryActions is IBaseRelayerLibrary {
    using Math for uint256;

    struct OutputReference {
        uint256 index;
        uint256 key;
    }

    function swap(
        IVault.SingleSwap memory singleSwap,
        IVault.FundManagement calldata funds,
        uint256 limit,
        uint256, // deadline (could remove, or leave in if we need to preserve the interface)
        uint256, // value
        uint256 outputReference
    ) external {
        require(funds.sender == msg.sender || funds.sender == address(this), "Incorrect sender");

        if (_isChainedReference(singleSwap.amount)) {
            singleSwap.amount = _getChainedReferenceValue(singleSwap.amount);
        }

        uint256 result = _querySwap(singleSwap, funds);

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
        uint256, // deadline (could remove, or leave in if we need to preserve the interface)
        uint256, // value
        OutputReference[] calldata outputReferences
    ) external payable {
        require(funds.sender == msg.sender || funds.sender == address(this), "Incorrect sender");

        for (uint256 i = 0; i < swaps.length; ++i) {
            uint256 amount = swaps[i].amount;
            if (_isChainedReference(amount)) {
                swaps[i].amount = _getChainedReferenceValue(amount);
            }
        }

        int256[] memory results = getVault().queryBatchSwap(kind, swaps, assets, funds);

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

    enum PoolKind { WEIGHTED, LEGACY_STABLE, COMPOSABLE_STABLE, COMPOSABLE_STABLE_V2 }

    function joinPool(
        bytes32 poolId,
        PoolKind kind,
        address sender,
        address recipient,
        IVault.JoinPoolRequest memory request,
        uint256, // value (could remove, or leave in if we need to preserve the interface)
        uint256 outputReference
    ) external {
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

    /**
     * @dev Compute the final userData for a join, depending on the PoolKind, performing replacements for chained
     * references as necessary.
     */
    function _doJoinPoolChainedReferenceReplacements(PoolKind kind, bytes memory userData)
        private
        returns (bytes memory)
    {
        if (kind == PoolKind.WEIGHTED) {
            return _doWeightedJoinChainedReferenceReplacements(userData);
        } else if (
            kind == PoolKind.LEGACY_STABLE ||
            kind == PoolKind.COMPOSABLE_STABLE ||
            kind == PoolKind.COMPOSABLE_STABLE_V2
        ) {
            return _doStableJoinChainedReferenceReplacements(userData);
        } else {
            revert("UNHANDLED_POOL_KIND");
        }
    }

    function _doWeightedJoinChainedReferenceReplacements(bytes memory userData) private returns (bytes memory) {
        WeightedPoolUserData.JoinKind kind = WeightedPoolUserData.joinKind(userData);

        if (kind == WeightedPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return _doWeightedExactTokensInForBPTOutReplacements(userData);
        } else {
            // All other join kinds are 'given out' (i.e the parameter is a BPT amount),
            // so we don't do replacements for those.
            return userData;
        }
    }

    function _doWeightedExactTokensInForBPTOutReplacements(bytes memory userData) private returns (bytes memory) {
        (uint256[] memory amountsIn, uint256 minBPTAmountOut) = WeightedPoolUserData.exactTokensInForBptOut(userData);

        // Save gas by only re-encoding the data if we actually performed a replacement
        return
            _replacedAmounts(amountsIn)
                ? abi.encode(WeightedPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, amountsIn, minBPTAmountOut)
                : userData;
    }

    function _doStableJoinChainedReferenceReplacements(bytes memory userData) private returns (bytes memory) {
        // The only 'given in' join (in which the parameters are the amounts in) is EXACT_TOKENS_IN_FOR_BPT_OUT,
        // so that is the only one where we do replacements. Luckily all versions of Stable Pool share the same
        // enum value for it, so we can treat them all the same, and just use the latest version.

        // Note that ComposableStablePool versions V2 and up support a proportional join kind, which some previous
        // versions did not. While it is not rejected here, if passed to the Pool it will revert.

        StablePoolUserData.JoinKind kind = StablePoolUserData.joinKind(userData);

        if (kind == StablePoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return _doStableExactTokensInForBPTOutReplacements(userData);
        } else {
            // All other join kinds are 'given out' (i.e the parameter is a BPT amount),
            // so we don't do replacements for those.
            return userData;
        }
    }

    function _doStableExactTokensInForBPTOutReplacements(bytes memory userData) private returns (bytes memory) {
        (uint256[] memory amountsIn, uint256 minBPTAmountOut) = StablePoolUserData.exactTokensInForBptOut(userData);

        // Save gas by only re-encoding the data if we actually performed a replacement
        return
            _replacedAmounts(amountsIn)
                ? abi.encode(StablePoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, amountsIn, minBPTAmountOut)
                : userData;
    }

    // Mutates amountsIn, and returns true if any replacements were made
    function _replacedAmounts(uint256[] memory amountsIn) private returns (bool) {
        bool madeReplacements = false;

        for (uint256 i = 0; i < amountsIn.length; ++i) {
            uint256 amount = amountsIn[i];
            if (_isChainedReference(amount)) {
                amountsIn[i] = _getChainedReferenceValue(amount);
                madeReplacements = true;
            }
        }

        return madeReplacements;
    }

    function exitPool(
        bytes32 poolId,
        PoolKind kind,
        address sender,
        address payable recipient,
        IVault.ExitPoolRequest memory request,
        OutputReference[] calldata outputReferences
    ) external {
        require(sender == msg.sender || sender == address(this), "Incorrect sender");

        // Exit the Pool
        request.userData = _doExitPoolChainedReferenceReplacements(kind, request.userData);

        uint256[] memory amountsOut = _queryExit(poolId, sender, recipient, request);

        // Save as chained references
        for (uint256 i = 0; i < outputReferences.length; i++) {
            _setChainedReferenceValue(outputReferences[i].key, amountsOut[i]);
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

    /**
     * @dev Compute the final userData for an exit, depending on the PoolKind, performing replacements for chained
     * references as necessary.
     */
    function _doExitPoolChainedReferenceReplacements(PoolKind kind, bytes memory userData)
        private
        returns (bytes memory)
    {
        if (kind == PoolKind.WEIGHTED) {
            return _doWeightedExitChainedReferenceReplacements(userData);
        } else {
            if (kind == PoolKind.LEGACY_STABLE) {
                return _doLegacyStableExitChainedReferenceReplacements(userData);
            } else if (kind == PoolKind.COMPOSABLE_STABLE) {
                return _doComposableStableExitChainedReferenceReplacements(userData);
            } else if (kind == PoolKind.COMPOSABLE_STABLE_V2) {
                return _doComposableStableV2ExitChainedReferenceReplacements(userData);
            } else {
                revert("UNHANDLED_POOL_KIND");
            }
        }
    }

    function _doWeightedExitChainedReferenceReplacements(bytes memory userData) private returns (bytes memory) {
        WeightedPoolUserData.ExitKind kind = WeightedPoolUserData.exitKind(userData);

        if (kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
            return _doWeightedExactBptInForOneTokenOutReplacements(userData);
        } else if (kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {
            return _doWeightedExactBptInForTokensOutReplacements(userData);
        } else {
            // All other exit kinds are 'given out' (i.e the parameter is a token amount),
            // so we don't do replacements for those.
            return userData;
        }
    }

    function _doWeightedExactBptInForOneTokenOutReplacements(bytes memory userData) private returns (bytes memory) {
        (uint256 bptAmountIn, uint256 tokenIndex) = WeightedPoolUserData.exactBptInForTokenOut(userData);

        if (_isChainedReference(bptAmountIn)) {
            bptAmountIn = _getChainedReferenceValue(bptAmountIn);
            return abi.encode(WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, bptAmountIn, tokenIndex);
        } else {
            // Save gas by only re-encoding the data if we actually performed a replacement
            return userData;
        }
    }

    function _doWeightedExactBptInForTokensOutReplacements(bytes memory userData) private returns (bytes memory) {
        uint256 bptAmountIn = WeightedPoolUserData.exactBptInForTokensOut(userData);

        if (_isChainedReference(bptAmountIn)) {
            bptAmountIn = _getChainedReferenceValue(bptAmountIn);
            return abi.encode(WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptAmountIn);
        } else {
            // Save gas by only re-encoding the data if we actually performed a replacement
            return userData;
        }
    }

    // Stable Pool version-dependent recoding dispatch functions

    /*
     * While all Stable Pool versions fortuitously support the same join kinds (V2 and higher support one extra),
     * they do NOT all support the same exit kinds. Also, though the encoding of the data associated with the exit
     * is uniform across pool kinds for the same exit method, the ExitKind ID itself may have a different value.
     *
     * For instance, BPT_IN_FOR_EXACT_TOKENS_OUT is 2 in legacy Stable Pools, but 1 in Composable Stable Pools.
     * (See the reference comment and libraries below.)
     *
     * Accordingly, the three do[PoolKind]ExitChainedReferenceReplacements functions below (for LegacyStable,
     * ComposableStable, and CopmosableStableV2) extract the exitKind and pass it through to the shared
     * recoding functions.
     */

    function _doLegacyStableExitChainedReferenceReplacements(bytes memory userData) private returns (bytes memory) {
        uint8 exitKind = uint8(StablePoolUserData.exitKind(userData));

        if (exitKind == uint8(LegacyStablePoolUserData.ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT)) {
            return _doStableExactBptInForOneTokenOutReplacements(userData, exitKind);
        } else if (exitKind == uint8(LegacyStablePoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT)) {
            return _doStableExactBptInForTokensOutReplacements(userData, exitKind);
        } else {
            // All other exit kinds are 'given out' (i.e the parameter is a token amount),
            // so we don't do replacements for those.
            return userData;
        }
    }

    // For the first deployment of ComposableStablePool
    function _doComposableStableExitChainedReferenceReplacements(bytes memory userData) private returns (bytes memory) {
        uint8 exitKind = uint8(StablePoolUserData.exitKind(userData));

        if (exitKind == uint8(ComposableStablePoolUserData.ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT)) {
            return _doStableExactBptInForOneTokenOutReplacements(userData, exitKind);
        } else {
            // All other exit kinds are 'given out' (i.e the parameter is a token amount),
            // so we don't do replacements for those.
            return userData;
        }
    }

    // For ComposableStablePool V2 and V3
    function _doComposableStableV2ExitChainedReferenceReplacements(bytes memory userData)
        private
        returns (bytes memory)
    {
        uint8 exitKind = uint8(StablePoolUserData.exitKind(userData));

        if (exitKind == uint8(StablePoolUserData.ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT)) {
            return _doStableExactBptInForOneTokenOutReplacements(userData, exitKind);
        } else if (exitKind == uint8(StablePoolUserData.ExitKind.EXACT_BPT_IN_FOR_ALL_TOKENS_OUT)) {
            return _doStableExactBptInForTokensOutReplacements(userData, exitKind);
        } else {
            // All other exit kinds are 'given out' (i.e the parameter is a token amount),
            // so we don't do replacements for those.
            return userData;
        }
    }

    // Shared Stable Exit recoding functions

    // The following two functions perform the actual recoding, which involves parsing and re-encoding the userData.
    // The encoding of the actual arguments is uniform across pool kinds, which allows these recoding functions to be
    // shared. However, the ExitKind ID itself can vary, so it must be passed in from each specific pool kind handler.

    function _doStableExactBptInForOneTokenOutReplacements(bytes memory userData, uint8 exitKind)
        private
        returns (bytes memory)
    {
        (uint256 bptAmountIn, uint256 tokenIndex) = StablePoolUserData.exactBptInForTokenOut(userData);

        if (_isChainedReference(bptAmountIn)) {
            bptAmountIn = _getChainedReferenceValue(bptAmountIn);
            return abi.encode(exitKind, bptAmountIn, tokenIndex);
        } else {
            // Save gas by only re-encoding the data if we actually performed a replacement
            return userData;
        }
    }

    function _doStableExactBptInForTokensOutReplacements(bytes memory userData, uint8 exitKind)
        private
        returns (bytes memory)
    {
        uint256 bptAmountIn = StablePoolUserData.exactBptInForTokensOut(userData);

        if (_isChainedReference(bptAmountIn)) {
            bptAmountIn = _getChainedReferenceValue(bptAmountIn);
            return abi.encode(exitKind, bptAmountIn);
        } else {
            // Save gas by only re-encoding the data if we actually performed a replacement
            return userData;
        }
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
}

/*
    For reference:

    StablePoolUserData (applies to ComposableStablePool V2+):

    enum JoinKind { INIT, EXACT_TOKENS_IN_FOR_BPT_OUT, TOKEN_IN_FOR_EXACT_BPT_OUT, ALL_TOKENS_IN_FOR_EXACT_BPT_OUT }
    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT, EXACT_BPT_IN_FOR_ALL_TOKENS_OUT }

    WeightedPoolUserData:

    enum JoinKind { INIT, EXACT_TOKENS_IN_FOR_BPT_OUT, TOKEN_IN_FOR_EXACT_BPT_OUT, ALL_TOKENS_IN_FOR_EXACT_BPT_OUT }
    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, EXACT_BPT_IN_FOR_TOKENS_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT }

    StablePhantomPools can only be exited proportionally when the pool is paused: and the pause window has expired.
    They have their own enum:

    enum ExitKindPhantom { EXACT_BPT_IN_FOR_TOKENS_OUT }
*/

// Applies to StablePool, MetaStablePool, StablePool V2
library LegacyStablePoolUserData {
    enum JoinKind { INIT, EXACT_TOKENS_IN_FOR_BPT_OUT, TOKEN_IN_FOR_EXACT_BPT_OUT }
    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, EXACT_BPT_IN_FOR_TOKENS_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT }
}

// Applies to the first deployment of ComposableStablePool (pre-Versioning)
library ComposableStablePoolUserData {
    enum JoinKind { INIT, EXACT_TOKENS_IN_FOR_BPT_OUT, TOKEN_IN_FOR_EXACT_BPT_OUT }
    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT }
}
