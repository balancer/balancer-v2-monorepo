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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

import "@balancer-labs/v2-pool-utils/contracts/lib/PoolRegistrationLib.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "./ManagedPoolStorageLib.sol";
import "./ManagedPoolTokenStorageLib.sol";

library ManagedPoolAddRemoveTokenLib {
    // ManagedPool weights and swap fees can change over time: these periods are expected to be long enough (e.g. days)
    // that any timestamp manipulation would achieve very little.
    // solhint-disable not-rely-on-time

    using FixedPoint for uint256;

    function _ensureNoWeightChange(bytes32 poolState) private view {
        (uint256 startTime, uint256 endTime) = ManagedPoolStorageLib.getWeightChangeFields(poolState);

        if (block.timestamp < endTime) {
            _revert(
                block.timestamp < startTime
                    ? Errors.CHANGE_TOKENS_PENDING_WEIGHT_CHANGE
                    : Errors.CHANGE_TOKENS_DURING_WEIGHT_CHANGE
            );
        }
    }

    /**
     * @notice Adds a token to the Pool's list of tradeable tokens.
     *
     * @dev By adding a token to the Pool's composition, the weights of all other tokens will be decreased. The new
     * token will have no balance - it is up to the owner to provide some immediately after calling this function.
     * Note however that regular join functions will not work while the new token has no balance: the only way to
     * deposit an initial amount is by using an Asset Manager.
     *
     * Token addition is forbidden during a weight change, or if one is scheduled to happen in the future.
     *
     * @param vault - The address of the Balancer Vault.
     * @param poolId - The bytes32 poolId of the Pool which to add the token.
     * @param poolState - The byte32 state of the Pool.
     * @param currentTokens - The array of IERC20 tokens held in the Pool prior to adding the new token.
     * @param currentWeights - The array of token weights prior to adding the new token.
     * @param tokenToAdd - The ERC20 token to be added to the Pool.
     * @param assetManager - The Asset Manager for the token.
     * @param tokenToAddNormalizedWeight - The normalized weight of `token` relative to the other tokens in the Pool.
     * @return tokenToAddState - The bytes32 state of the token which has been added.
     * @return newTokens - The updated tokens array once the token has been added.
     * @return newWeights - The updated weights array once the token has been added.
     */
    function addToken(
        IVault vault,
        bytes32 poolId,
        bytes32 poolState,
        IERC20[] memory currentTokens,
        uint256[] memory currentWeights,
        IERC20 tokenToAdd,
        address assetManager,
        uint256 tokenToAddNormalizedWeight
    )
        external
        returns (
            bytes32 tokenToAddState,
            IERC20[] memory newTokens,
            uint256[] memory newWeights
        )
    {
        // BPT cannot be added using this mechanism: Composable Pools manage it via dedicated PoolRegistrationLib
        // functions.
        _require(tokenToAdd != IERC20(address(this)), Errors.ADD_OR_REMOVE_BPT);

        // Tokens cannot be added during or before a weight change, since a) adding a token already involves a weight
        // change and would override an existing one, and b) any previous weight changes would be incomplete since they
        // wouldn't include the new token.
        _ensureNoWeightChange(poolState);

        // We first register the token in the Vault. This makes the Pool enter an invalid state, since one of its tokens
        // has a balance of zero (making the invariant also zero). The Asset Manager must be used to deposit some
        // initial balance and restore regular operation.
        //
        // We don't need to check that the new token is not already in the Pool, as the Vault will simply revert if we
        // try to register it again.
        PoolRegistrationLib.registerToken(vault, poolId, tokenToAdd, assetManager);

        // Once we've updated the state in the Vault, we need to also update our own state. This is a two-step process,
        // since we need to:
        //  a) initialize the state of the new token
        //  b) adjust the weights of all other tokens

        // Initializing the new token is straightforward. The Pool itself doesn't track how many or which tokens it uses
        // (and relies instead on the Vault for this), so we simply store the new token-specific information.
        // Note that we don't need to check here that the weight is valid as this is enforced when updating the weights.
        tokenToAddState = ManagedPoolTokenStorageLib.initializeTokenState(tokenToAdd, tokenToAddNormalizedWeight);

        // Adjusting the weights is a bit more involved however. We need to reduce all other weights to make room for
        // the new one. This is achieved by multipliyng them by a factor of `1 - new token weight`.
        // For example, if a  0.25/0.75 Pool gets added a token with a weight of 0.80, the final weights would be
        // 0.05/0.15/0.80, where 0.05 = 0.25 * (1 - 0.80) and 0.15 = 0.75 * (1 - 0.80).
        uint256 newWeightSum = 0;
        newTokens = new IERC20[](currentTokens.length + 1);
        newWeights = new uint256[](currentWeights.length + 1);
        for (uint256 i = 0; i < currentWeights.length; ++i) {
            newTokens[i] = currentTokens[i];

            newWeights[i] = currentWeights[i].mulDown(FixedPoint.ONE.sub(tokenToAddNormalizedWeight));
            newWeightSum = newWeightSum.add(newWeights[i]);
        }

        // Newly added tokens are always appended to the end of the existing array.
        newTokens[newTokens.length - 1] = tokenToAdd;

        // At this point `newWeights` contains the updated weights for all tokens other than the token to be added.
        // We could naively write `tokenToAddNormalizedWeight` into the last element of the `newWeights` array however,
        // it is possible that the new weights don't add up to 100% due to rounding errors - the sum might be slightly
        // smaller since we round the weights down. Due to this, we adjust the last weight so that the sum is exact.
        //
        // This error is negligible, since the error introduced in the weight of the last token equals the number of
        // tokens in the worst case (as each weight can be off by one at most), and the minimum weight is 1e16, meaning
        // there's ~15 orders of magnitude between the smallest weight and the error. It is important however that the
        // weights do add up to 100% exactly, as that property is relied on in some parts of the WeightedMath
        // computations.
        newWeights[newWeights.length - 1] = FixedPoint.ONE.sub(newWeightSum);
    }

    /**
     * @notice Removes a token from the Pool's list of tradeable tokens.
     * @dev Tokens can only be removed if the Pool has more than 2 tokens, as it can never have fewer than 2.
     *
     * Token removal is also forbidden during a weight change, or if one is scheduled to happen in the future.
     *
     * @param vault - The address of the Balancer Vault.
     * @param poolId - The bytes32 poolId of the Pool which to add the token.
     * @param poolState - The byte32 state of the Pool.
     * @param currentTokens - The array of IERC20 tokens held in the Pool prior to adding the new token.
     * @param currentWeights - The array of token weights prior to adding the new token.
     * @param tokenToRemove - The ERC20 token to be removed from the Pool.
     * @param tokenToRemoveNormalizedWeight - The normalized weight of `tokenToRemove`.
     * @return newTokens - The updated tokens array once the token has been removed.
     * @return newWeights - The updated weights array once the token has been removed.
     */
    function removeToken(
        IVault vault,
        bytes32 poolId,
        bytes32 poolState,
        IERC20[] memory currentTokens,
        uint256[] memory currentWeights,
        IERC20 tokenToRemove,
        uint256 tokenToRemoveNormalizedWeight
    ) external returns (IERC20[] memory newTokens, uint256[] memory newWeights) {
        // BPT cannot be removed using this mechanism: Composable Pools manage it via dedicated PoolRegistrationLib
        // functions.
        _require(tokenToRemove != IERC20(address(this)), Errors.ADD_OR_REMOVE_BPT);

        // Tokens cannot be removed during or before a weight change, since a) removing a token already involves a
        // weight change and would override an existing one, and b) any previous weight changes would be incorrect since
        // they would include the removed token.
        _ensureNoWeightChange(poolState);

        // Before this function is called, the caller must have withdrawn all balance for `token` from the Pool. This
        // means that the Pool is in an invalid state, since among other things the invariant is zero. Because we're not
        // in a valid state and all value-changing operations will revert, we are free to modify the Pool state (e.g.
        // alter weights).
        //
        // We don't need to test the zero balance since the Vault will simply revert on deregistration if this is not
        // the case, or if the token is not currently registered.
        PoolRegistrationLib.deregisterToken(vault, poolId, tokenToRemove);

        // Once we've updated the state in the Vault, we need to also update our own state. This is a two-step process,
        // since we need to:
        //  a) delete the state of the removed token
        //  b) adjust the weights of all other tokens

        // Adjusting the weights is a bit more involved however. We need to increase all other weights so that they add
        // up to 100%. This is achieved by dividing them by a factor of `1 - old token weight`.
        // For example, if a  0.05/0.15/0.80 Pool has its 80% token removed, the final weights would be 0.25/0.75, where
        // 0.25 = 0.05 / (1 - 0.80) and 0.75 = 0.15 / (1 - 0.80).
        uint256 newWeightSum = 0;
        newTokens = new IERC20[](currentTokens.length - 1);
        newWeights = new uint256[](currentWeights.length - 1);
        for (uint256 i = 0; i < newWeights.length; ++i) {
            if (currentTokens[i] == tokenToRemove) {
                // If we're at the index of the removed token then want to instead insert the weight of the final token.
                // This is because the token at the end of the array will be moved into the index of the removed token
                // in a "swap and pop" operation.
                newTokens[i] = currentTokens[currentTokens.length - 1];
                newWeights[i] = currentWeights[currentWeights.length - 1].divDown(
                    FixedPoint.ONE.sub(tokenToRemoveNormalizedWeight)
                );
            } else {
                newTokens[i] = currentTokens[i];
                newWeights[i] = currentWeights[i].divDown(FixedPoint.ONE.sub(tokenToRemoveNormalizedWeight));
            }
            newWeightSum = newWeightSum.add(newWeights[i]);
        }

        // It is possible that the new weights don't add up to 100% due to rounding errors - the sum might be slightly
        // smaller since we round the weights down. In that case, we adjust the last weight so that the sum is exact.
        //
        // This error is negligible, since the error introduced in the weight of the last token equals the number of
        // tokens in the worst case (as each weight can be off by one at most), and the minimum weight is 1e16, meaning
        // there's ~15 orders of magnitude between the smallest weight and the error. It is important however that the
        // weights do add up to 100% exactly, as that property is relied on in some parts of the WeightedMath
        // computations.
        if (newWeightSum != FixedPoint.ONE) {
            newWeights[newWeights.length - 1] = newWeights[newWeights.length - 1].add(FixedPoint.ONE.sub(newWeightSum));
        }
    }
}
