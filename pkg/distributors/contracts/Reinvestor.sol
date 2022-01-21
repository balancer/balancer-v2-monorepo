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

import "@balancer-labs/v2-pool-weighted/contracts/WeightedPoolUserData.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAsset.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";

import "./PoolTokenCache.sol";
import "./interfaces/IDistributorCallback.sol";

contract Reinvestor is PoolTokenCache, IDistributorCallback {
    using EnumerableSet for EnumerableSet.AddressSet;

    constructor(IVault _vault) PoolTokenCache(_vault) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function _initializeArrays(bytes32 poolId, IERC20[] memory tokens)
        internal
        view
        returns (uint256[] memory amountsIn, IVault.UserBalanceOp[] memory leftoverOps)
    {
        uint256 joinTokensCount;
        uint256 leftoverTokensCount;
        for (uint256 t; t < tokens.length; t++) {
            if (poolHasToken(poolId, address(tokens[t]))) {
                joinTokensCount++;
            }
        }
        leftoverTokensCount = tokens.length - joinTokensCount;

        amountsIn = new uint256[](poolTokensLength(poolId));

        leftoverOps = new IVault.UserBalanceOp[](leftoverTokensCount);
    }

    function _populateArrays(
        bytes32 poolId,
        address recipient,
        IERC20[] memory tokens,
        uint256[] memory internalBalances,
        uint256[] memory amountsIn,
        IVault.UserBalanceOp[] memory leftoverOps
    ) internal view {
        uint256 leftoverOpsIdx;

        for (uint256 t; t < tokens.length; t++) {
            address token = address(tokens[t]);

            if (poolHasToken(poolId, token)) {
                amountsIn[_poolTokenIndex(poolId, token)] = internalBalances[t];
            } else {
                leftoverOps[leftoverOpsIdx] = IVault.UserBalanceOp({
                    asset: IAsset(token),
                    amount: internalBalances[t], // callbackAmounts have been subtracted
                    sender: address(this),
                    recipient: payable(recipient),
                    kind: IVault.UserBalanceOpKind.WITHDRAW_INTERNAL
                });
                leftoverOpsIdx++;
            }
        }
    }

    struct CallbackParams {
        address payable recipient;
        bytes32 poolId;
        IERC20[] tokens;
    }

    /**
     * @notice Reinvests tokens in a specified pool
     * @param callbackData - the encoded function arguments
     * recipient - the recipient of the bpt and leftover funds
     * poolId - The pool to receive the tokens
     * tokens - The tokens that were received
     */
    function distributorCallback(bytes calldata callbackData) external override {
        CallbackParams memory params = abi.decode(callbackData, (CallbackParams));

        ensurePoolTokenSetSaved(params.poolId);

        IAsset[] memory assets = _getAssets(params.poolId);

        (uint256[] memory amountsIn, IVault.UserBalanceOp[] memory leftoverOps) = _initializeArrays(
            params.poolId,
            params.tokens
        );

        uint256[] memory internalBalances = vault.getInternalBalance(address(this), params.tokens);
        _populateArrays(params.poolId, params.recipient, params.tokens, internalBalances, amountsIn, leftoverOps);

        _joinPool(params.poolId, params.recipient, assets, amountsIn);
        vault.manageUserBalance(leftoverOps);
    }

    function _joinPool(
        bytes32 poolId,
        address recipient,
        IAsset[] memory assets,
        uint256[] memory amountsIn
    ) internal {
        bytes memory userData = abi.encode(
            WeightedPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT,
            amountsIn,
            uint256(0)
        );

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest(assets, amountsIn, userData, true);

        vault.joinPool(poolId, address(this), recipient, request);
    }
}
