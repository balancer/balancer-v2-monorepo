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
import "@balancer-labs/v2-interfaces/contracts/pool-utils/BasePoolUserData.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/VaultHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title VaultActions
 * @notice Allows users to call the core functions on the Balancer Vault (swaps/joins/exits/user balance management)
 * @dev Since the relayer is not expected to hold user funds, we expect the user to be the recipient of any token
 * transfers from the Vault.
 *
 * All functions must be payable so they can be called from a multicall involving ETH.
 *
 * Note that this is a base contract for VaultQueryActions. Any functions that should not be called in a query context
 * (e.g., `manageUserBalance`), should be virtual here, and overridden to revert in VaultQueryActions.
 */
abstract contract VaultActions is IBaseRelayerLibrary {
    using Math for uint256;

    /**
     * @dev In a relayer, "chaining" - passing values between otherwise independent operations in a multicall - is
     * achieved by passing reference structures between operations. Each reference has an index, corresponding to
     * an offset into the input or output array (e.g., 0 means the first element of the inputs or results), and
     * a key (computed from a hash of the index and some text), which is interpreted as a storage slot. Note that
     * the actual data of the reference is NOT stored in the reference structure, but rather at the storage slot
     * given by the key.
     *
     * The relayer uses masking on the unused MSB bits of all incoming and outgoing values to identify which are
     * references, and which are simply values that can be used directly. Incoming references are replaced with
     * their values before being forwarded to the underlying function. Likewise, outputs of underlying functions
     * that need to be chained are converted to references before being passed as inputs to the next function.
     * See `BaseRelayerLibrary`.
     */
    struct OutputReference {
        uint256 index;
        uint256 key;
    }

    function swap(
        IVault.SingleSwap memory singleSwap,
        IVault.FundManagement calldata funds,
        uint256 limit,
        uint256 deadline,
        uint256 value,
        uint256 outputReference
    ) external payable virtual returns (uint256 result) {
        require(funds.sender == msg.sender || funds.sender == address(this), "Incorrect sender");

        if (_isChainedReference(singleSwap.amount)) {
            singleSwap.amount = _getChainedReferenceValue(singleSwap.amount);
        }

        result = getVault().swap{ value: value }(singleSwap, funds, limit, deadline);

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, result);
        }
    }

    function batchSwap(
        IVault.SwapKind kind,
        IVault.BatchSwapStep[] memory swaps,
        IAsset[] calldata assets,
        IVault.FundManagement calldata funds,
        int256[] calldata limits,
        uint256 deadline,
        uint256 value,
        OutputReference[] calldata outputReferences
    ) external payable virtual returns (int256[] memory results) {
        require(funds.sender == msg.sender || funds.sender == address(this), "Incorrect sender");

        for (uint256 i = 0; i < swaps.length; ++i) {
            uint256 amount = swaps[i].amount;
            if (_isChainedReference(amount)) {
                swaps[i].amount = _getChainedReferenceValue(amount);
            }
        }

        results = getVault().batchSwap{ value: value }(kind, swaps, assets, funds, limits, deadline);

        for (uint256 i = 0; i < outputReferences.length; ++i) {
            require(_isChainedReference(outputReferences[i].key), "invalid chained reference");

            // Batch swap return values are signed, as they are Vault deltas (positive values correspond to assets sent
            // to the Vault, and negative values are assets received from the Vault). To simplify the chained reference
            // value model, we simply store the absolute value.
            // This should be fine for most use cases, as the caller can reason about swap results via the `limits`
            // parameter.
            _setChainedReferenceValue(outputReferences[i].key, Math.abs(results[outputReferences[i].index]));
        }
    }

    function manageUserBalance(
        IVault.UserBalanceOp[] memory ops,
        uint256 value,
        OutputReference[] calldata outputReferences
    ) external payable virtual {
        for (uint256 i = 0; i < ops.length; i++) {
            require(ops[i].sender == msg.sender || ops[i].sender == address(this), "Incorrect sender");

            uint256 amount = ops[i].amount;
            if (_isChainedReference(amount)) {
                ops[i].amount = _getChainedReferenceValue(amount);
            }
        }

        getVault().manageUserBalance{ value: value }(ops);

        // `manageUserBalance` does not return results, but there is no calculation of amounts as with swaps.
        // We can just use the original amounts.
        for (uint256 i = 0; i < outputReferences.length; ++i) {
            require(_isChainedReference(outputReferences[i].key), "invalid chained reference");

            _setChainedReferenceValue(outputReferences[i].key, ops[outputReferences[i].index].amount);
        }
    }

    enum PoolKind { WEIGHTED, LEGACY_STABLE, COMPOSABLE_STABLE, COMPOSABLE_STABLE_V2 }

    function joinPool(
        bytes32 poolId,
        PoolKind kind,
        address sender,
        address recipient,
        IVault.JoinPoolRequest memory request,
        uint256 value,
        uint256 outputReference
    ) external payable virtual {
        require(sender == msg.sender || sender == address(this), "Incorrect sender");

        // The output of a join will be the Pool's token contract, typically known as BPT (Balancer Pool Tokens).
        // Since the Vault is unaware of this (BPT tokens are minted directly to the recipient), we manually
        // measure this balance increase: but only if an output reference is provided.
        IERC20 bpt = IERC20(VaultHelpers.toPoolAddress(poolId));
        uint256 maybeInitialRecipientBPT = _isChainedReference(outputReference) ? bpt.balanceOf(recipient) : 0;

        request.userData = _doJoinPoolChainedReferenceReplacements(kind, request.userData);

        getVault().joinPool{ value: value }(poolId, sender, recipient, request);

        if (_isChainedReference(outputReference)) {
            // In this context, `maybeInitialRecipientBPT` is guaranteed to have been initialized, so we can safely read
            // from it. Note that we assume the recipient balance change has a positive sign (i.e. the recipient
            // received BPT).
            uint256 finalRecipientBPT = bpt.balanceOf(recipient);
            _setChainedReferenceValue(outputReference, finalRecipientBPT.sub(maybeInitialRecipientBPT));
        }
    }

    /**
     * @dev Compute the final userData for a join, depending on the PoolKind, performing replacements for chained
     * references as necessary.
     */
    function _doJoinPoolChainedReferenceReplacements(PoolKind kind, bytes memory userData)
        internal
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
    ) external payable virtual {
        require(sender == msg.sender || sender == address(this), "Incorrect sender");

        // To track the changes of internal balances, we need an array of token addresses.
        // We save this here to avoid having to recalculate after the exit.
        IERC20[] memory trackedTokens = new IERC20[](outputReferences.length);

        // Query initial balances for all tokens, and record them as chained references
        uint256[] memory initialRecipientBalances = new uint256[](outputReferences.length);
        for (uint256 i = 0; i < outputReferences.length; i++) {
            require(_isChainedReference(outputReferences[i].key), "invalid chained reference");

            IAsset asset = request.assets[outputReferences[i].index];
            if (request.toInternalBalance) {
                trackedTokens[i] = _asIERC20(asset);
            } else {
                initialRecipientBalances[i] = _isETH(asset) ? recipient.balance : _asIERC20(asset).balanceOf(recipient);
            }
        }
        if (request.toInternalBalance) {
            initialRecipientBalances = getVault().getInternalBalance(recipient, trackedTokens);
        }

        // Exit the Pool
        request.userData = _doExitPoolChainedReferenceReplacements(kind, request.userData);
        getVault().exitPool(poolId, sender, recipient, request);

        // Query final balances for all tokens of interest
        uint256[] memory finalRecipientTokenBalances = new uint256[](outputReferences.length);
        if (request.toInternalBalance) {
            finalRecipientTokenBalances = getVault().getInternalBalance(recipient, trackedTokens);
        } else {
            for (uint256 i = 0; i < outputReferences.length; i++) {
                IAsset asset = request.assets[outputReferences[i].index];
                finalRecipientTokenBalances[i] = _isETH(asset)
                    ? recipient.balance
                    : _asIERC20(asset).balanceOf(recipient);
            }
        }

        // Calculate deltas and save as chained references
        for (uint256 i = 0; i < outputReferences.length; i++) {
            _setChainedReferenceValue(
                outputReferences[i].key,
                finalRecipientTokenBalances[i].sub(initialRecipientBalances[i])
            );
        }
    }

    /**
     * @dev Compute the final userData for an exit, depending on the PoolKind, performing replacements for chained
     * references as necessary.
     */
    function _doExitPoolChainedReferenceReplacements(PoolKind kind, bytes memory userData)
        internal
        returns (bytes memory)
    {
        // Must check for the recovery mode ExitKind first, which is common to all pool types.
        // If it is just a regular exit, pass it to the appropriate PoolKind handler for interpretation.
        if (BasePoolUserData.isRecoveryModeExitKind(userData)) {
            return _doRecoveryExitReplacements(userData);
        } else if (kind == PoolKind.WEIGHTED) {
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

    function _doRecoveryExitReplacements(bytes memory userData) private returns (bytes memory) {
        uint256 bptAmountIn = BasePoolUserData.recoveryModeExit(userData);

        if (_isChainedReference(bptAmountIn)) {
            bptAmountIn = _getChainedReferenceValue(bptAmountIn);
            return abi.encode(BasePoolUserData.RECOVERY_MODE_EXIT_KIND, bptAmountIn);
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
