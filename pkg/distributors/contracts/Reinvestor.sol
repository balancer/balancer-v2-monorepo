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

import "@balancer-labs/v2-pool-weighted/contracts/BaseWeightedPool.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAsset.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";

contract Reinvestor {
    using EnumerableSet for EnumerableSet.AddressSet;

    IVault public immutable vault;

    mapping(bytes32 => EnumerableSet.AddressSet) private _poolTokenSets;
    mapping(bytes32 => bool) private __poolTokenSetSaved;

    constructor(IVault _vault) {
        vault = _vault;
    }

    modifier withPoolTokenSetSaved(bytes32 poolId) {
        // create a set of the pool tokens if it doesn't exist
        if (!__poolTokenSetSaved[poolId]) {
            (IERC20[] memory poolTokens, , ) = vault.getPoolTokens(poolId);
            for (uint256 pt; pt < poolTokens.length; pt++) {
                _poolTokenSets[poolId].add(address(poolTokens[pt]));
            }
        }
        _;
    }

    function _initializeArrays(bytes32 poolId, IERC20[] calldata tokens)
        internal
        returns (
            IAsset[] memory assets,
            uint256[] memory amountsIn,
            IVault.UserBalanceOp[] memory leftoverOps
        )
    {
        uint256 poolTokensLength = _poolTokenSets[poolId].length();

        assets = new IAsset[](poolTokensLength);
        for (uint256 pt; pt < poolTokensLength; pt++) {
            assets[pt] = IAsset(_poolTokenSets[poolId].unchecked_at(pt));
        }

        uint256 joinTokensCount;
        uint256 leftoverTokensCount;
        for (uint256 t; t < tokens.length; t++) {
            if (_poolTokenSets[poolId].contains(address(tokens[t]))) {
                joinTokensCount++;
            }
        }
        leftoverTokensCount = tokens.length - joinTokensCount;

        amountsIn = new uint256[](poolTokensLength);

        leftoverOps = new IVault.UserBalanceOp[](leftoverTokensCount);
    }

    function _populateArrays(
        bytes32 poolId,
        address payable recipient,
        IERC20[] calldata tokens,
        uint256[] memory internalBalances,
        uint256[] memory amountsIn,
        IVault.UserBalanceOp[] memory leftoverOps
    ) internal {
        uint256 leftoverOpsIdx;

        for (uint256 t; t < tokens.length; t++) {
            address token = address(tokens[t]);
            require(internalBalances[t] >= 0, "Token provided was not sent to the reinvestor");

            if (_poolTokenSets[poolId].contains(token)) {
                amountsIn[_poolTokenSets[poolId].rawIndexOf(token)] = internalBalances[t];
            } else {
                leftoverOps[leftoverOpsIdx] = IVault.UserBalanceOp({
                    asset: IAsset(token),
                    amount: internalBalances[t], // callbackAmounts have been subtracted
                    sender: address(this),
                    recipient: recipient,
                    kind: IVault.UserBalanceOpKind.WITHDRAW_INTERNAL
                });
                leftoverOpsIdx++;
            }
        }
    }

    /**
     * @notice Reinvests tokens in a specified pool
     * @param recipient - the recipient of the bpt and leftover funds
     * @param poolId - The pool to receive the tokens
     * @param tokens - The tokens that were received
     */
    function callback(
        address payable recipient,
        bytes32 poolId,
        IERC20[] calldata tokens // all assets that were transfered over
    ) external withPoolTokenSetSaved(poolId) {
        (
            IAsset[] memory assets,
            uint256[] memory amountsIn,
            IVault.UserBalanceOp[] memory leftoverOps
        ) = _initializeArrays(poolId, tokens);

        uint256[] memory internalBalances = vault.getInternalBalance(address(this), tokens);
        _populateArrays(poolId, recipient, tokens, internalBalances, amountsIn, leftoverOps);

        _joinPool(poolId, recipient, assets, amountsIn);
        vault.manageUserBalance(leftoverOps);
        return;
    }

    function _joinPool(
        bytes32 poolId,
        address payable recipient,
        IAsset[] memory assets,
        uint256[] memory amountsIn
    ) internal {
        bytes memory userData = abi.encode(
            BaseWeightedPool.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT,
            amountsIn,
            uint256(0)
        );

        IVault.JoinPoolRequest memory request = IVault.JoinPoolRequest(assets, amountsIn, userData, true);

        vault.joinPool(poolId, address(this), recipient, request);
    }
}
