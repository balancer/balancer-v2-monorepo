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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

import "./BalanceAllocation.sol";
import "../PoolRegistry.sol";

abstract contract TwoTokenPoolsBalance is PoolRegistry {
    using BalanceAllocation for bytes32;

    // Data for Pools with the Two Token specialization setting
    //
    // These are similar to the Minimal Swap Info Pool case (because the Pool only has two tokens, and therefore there
    // are only two balances to read), but there's a key difference in how data is stored. Keeping a set makes little
    // sense, as it will only ever hold two tokens, so we can just store those two directly.
    //
    // The gas savings associated with using these Pools come from how token balances are stored: cash amounts for token
    // A and token B are packed together, as are managed amounts. Because only cash changes in a swap, there's no need
    // to write to this second storage slot. A single last change block number for both tokens is stored with the packed
    // cash fields.

    struct TwoTokenPoolBalances {
        bytes32 sharedCash;
        bytes32 sharedManaged;
    }

    // We could just keep a mapping from Pool ID to TwoTokenSharedBalances, but there's an issue: we wouldn't know to
    // which tokens those balances correspond. This would mean having to also check which are registered with the Pool.
    //
    // What we do instead to save those storage reads is keep a nested mapping from the token pair hash to the balances
    // struct. The Pool only has two tokens, so only a single entry of this mapping is set (the one that corresponds to
    // that pair's hash).
    //
    // This has the trade-off of making Vault code that interacts with these Pools cumbersome: both balances must be
    // accessed at the same time by using both token addresses, and some logic is needed to determine how the pair hash
    // is computed. We do this by sorting the tokens, calling the token with the lowest numerical address value token A,
    // and the other one token B. In functions where the token arguments could be either A or B, we use X and Y instead.
    //
    // If users query a token pair containing an unregistered token, the Pool will generate a hash for a mapping entry
    // that was not set, and return zero balances. Non-zero balances are only possible if both tokens in the pair
    // are registered with the Pool, which means we don't have to check the TwoTokenPoolTokens struct, and can save
    // storage reads.

    struct TwoTokenPoolTokens {
        IERC20 tokenA;
        IERC20 tokenB;
        mapping(bytes32 => TwoTokenPoolBalances) balances;
    }

    mapping(bytes32 => TwoTokenPoolTokens) private _twoTokenPoolTokens;

    /**
     * @dev Registers tokens in a Two Token Pool.
     *
     * This function assumes `poolId` exists and corresponds to the Two Token specialization setting.
     *
     * Requirements:
     *
     * - `tokenX` and `tokenY` must not be the same
     * - The tokens must be ordered: tokenX < tokenY
     */
    function _registerTwoTokenPoolTokens(
        bytes32 poolId,
        IERC20 tokenX,
        IERC20 tokenY
    ) internal {
        // Not technically true since we didn't register yet, but this is consistent with the error messages of other
        // specialization settings.
        _require(tokenX != tokenY, Errors.TOKEN_ALREADY_REGISTERED);

        _require(tokenX < tokenY, Errors.UNSORTED_TOKENS);

        // A Two Token Pool with no registered tokens is identified by having zero addresses for tokens A and B.
        TwoTokenPoolTokens storage poolTokens = _twoTokenPoolTokens[poolId];
        _require(poolTokens.tokenA == IERC20(0) && poolTokens.tokenB == IERC20(0), Errors.TOKENS_ALREADY_SET);

        // Since tokenX < tokenY, tokenX is A and tokenY is B
        poolTokens.tokenA = tokenX;
        poolTokens.tokenB = tokenY;

        // Note that we don't initialize the balance mapping: the default value of zero corresponds to an empty
        // balance.
    }

    /**
     * @dev Deregisters tokens in a Two Token Pool.
     *
     * This function assumes `poolId` exists and corresponds to the Two Token specialization setting.
     *
     * Requirements:
     *
     * - `tokenX` and `tokenY` must be registered in the Pool
     * - both tokens must have zero balance in the Vault
     */
    function _deregisterTwoTokenPoolTokens(
        bytes32 poolId,
        IERC20 tokenX,
        IERC20 tokenY
    ) internal {
        (
            bytes32 balanceA,
            bytes32 balanceB,
            TwoTokenPoolBalances storage poolBalances
        ) = _getTwoTokenPoolSharedBalances(poolId, tokenX, tokenY);

        _require(balanceA.isZero() && balanceB.isZero(), Errors.NONZERO_TOKEN_BALANCE);

        delete _twoTokenPoolTokens[poolId];

        // For consistency with other Pool specialization settings, we explicitly reset the packed cash field (which may
        // have a non-zero last change block).
        delete poolBalances.sharedCash;
    }

    /**
     * @dev Sets the cash balances of a Two Token Pool's tokens.
     *
     * WARNING: this assumes `tokenA` and `tokenB` are the Pool's two registered tokens, and are in the correct order.
     */
    function _setTwoTokenPoolCashBalances(
        bytes32 poolId,
        IERC20 tokenA,
        bytes32 balanceA,
        IERC20 tokenB,
        bytes32 balanceB
    ) internal {
        bytes32 pairHash = _getTwoTokenPairHash(tokenA, tokenB);
        TwoTokenPoolBalances storage poolBalances = _twoTokenPoolTokens[poolId].balances[pairHash];
        poolBalances.sharedCash = BalanceAllocation.toSharedCash(balanceA, balanceB);
    }

    /**
     * @dev Transforms `amount` of `token`'s balance in a Two Token Pool from cash into managed.
     *
     * This function assumes `poolId` exists, corresponds to the Two Token specialization setting, and that `token` is
     * registered for that Pool.
     */
    function _twoTokenPoolCashToManaged(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateTwoTokenPoolSharedBalance(poolId, token, BalanceAllocation.cashToManaged, amount);
    }

    /**
     * @dev Transforms `amount` of `token`'s balance in a Two Token Pool from managed into cash.
     *
     * This function assumes `poolId` exists, corresponds to the Two Token specialization setting, and that `token` is
     * registered for that Pool.
     */
    function _twoTokenPoolManagedToCash(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateTwoTokenPoolSharedBalance(poolId, token, BalanceAllocation.managedToCash, amount);
    }

    /**
     * @dev Sets `token`'s managed balance in a Two Token Pool to `amount`.
     *
     * This function assumes `poolId` exists, corresponds to the Two Token specialization setting, and that `token` is
     * registered for that Pool.
     *
     * Returns the managed balance delta as a result of this call.
     */
    function _setTwoTokenPoolManagedBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal returns (int256) {
        return _updateTwoTokenPoolSharedBalance(poolId, token, BalanceAllocation.setManaged, amount);
    }

    /**
     * @dev Sets `token`'s balance in a Two Token Pool to the result of the `mutation` function when called with
     * the current balance and `amount`.
     *
     * This function assumes `poolId` exists, corresponds to the Two Token specialization setting, and that `token` is
     * registered for that Pool.
     *
     * Returns the managed balance delta as a result of this call.
     */
    function _updateTwoTokenPoolSharedBalance(
        bytes32 poolId,
        IERC20 token,
        function(bytes32, uint256) returns (bytes32) mutation,
        uint256 amount
    ) private returns (int256) {
        (
            TwoTokenPoolBalances storage balances,
            IERC20 tokenA,
            bytes32 balanceA,
            ,
            bytes32 balanceB
        ) = _getTwoTokenPoolBalances(poolId);

        int256 delta;
        if (token == tokenA) {
            bytes32 newBalance = mutation(balanceA, amount);
            delta = newBalance.managedDelta(balanceA);
            balanceA = newBalance;
        } else {
            // token == tokenB
            bytes32 newBalance = mutation(balanceB, amount);
            delta = newBalance.managedDelta(balanceB);
            balanceB = newBalance;
        }

        balances.sharedCash = BalanceAllocation.toSharedCash(balanceA, balanceB);
        balances.sharedManaged = BalanceAllocation.toSharedManaged(balanceA, balanceB);

        return delta;
    }

    /*
     * @dev Returns an array with all the tokens and balances in a Two Token Pool. The order may change when
     * tokens are registered or deregistered.
     *
     * This function assumes `poolId` exists and corresponds to the Two Token specialization setting.
     */
    function _getTwoTokenPoolTokens(bytes32 poolId)
        internal
        view
        returns (IERC20[] memory tokens, bytes32[] memory balances)
    {
        (, IERC20 tokenA, bytes32 balanceA, IERC20 tokenB, bytes32 balanceB) = _getTwoTokenPoolBalances(poolId);

        // Both tokens will either be zero (if unregistered) or non-zero (if registered), but we keep the full check for
        // clarity.
        if (tokenA == IERC20(0) || tokenB == IERC20(0)) {
            return (new IERC20[](0), new bytes32[](0));
        }

        // Note that functions relying on this getter expect tokens to be properly ordered, so we use the (A, B)
        // ordering.

        tokens = new IERC20[](2);
        tokens[0] = tokenA;
        tokens[1] = tokenB;

        balances = new bytes32[](2);
        balances[0] = balanceA;
        balances[1] = balanceB;
    }

    /**
     * @dev Same as `_getTwoTokenPoolTokens`, except it returns the two tokens and balances directly instead of using
     * an array, as well as a storage pointer to the `TwoTokenPoolBalances` struct, which can be used to update it
     * without having to recompute the pair hash and storage slot.
     */
    function _getTwoTokenPoolBalances(bytes32 poolId)
        private
        view
        returns (
            TwoTokenPoolBalances storage poolBalances,
            IERC20 tokenA,
            bytes32 balanceA,
            IERC20 tokenB,
            bytes32 balanceB
        )
    {
        TwoTokenPoolTokens storage poolTokens = _twoTokenPoolTokens[poolId];
        tokenA = poolTokens.tokenA;
        tokenB = poolTokens.tokenB;

        bytes32 pairHash = _getTwoTokenPairHash(tokenA, tokenB);
        poolBalances = poolTokens.balances[pairHash];

        bytes32 sharedCash = poolBalances.sharedCash;
        bytes32 sharedManaged = poolBalances.sharedManaged;

        balanceA = BalanceAllocation.fromSharedToBalanceA(sharedCash, sharedManaged);
        balanceB = BalanceAllocation.fromSharedToBalanceB(sharedCash, sharedManaged);
    }

    /**
     * @dev Returns the balance of a token in a Two Token Pool.
     *
     * This function assumes `poolId` exists and corresponds to the General specialization setting.
     *
     * This function is convenient but not particularly gas efficient, and should be avoided during gas-sensitive
     * operations, such as swaps. For those, _getTwoTokenPoolSharedBalances provides a more flexible interface.
     *
     * Requirements:
     *
     * - `token` must be registered in the Pool
     */
    function _getTwoTokenPoolBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        // We can't just read the balance of token, because we need to know the full pair in order to compute the pair
        // hash and access the balance mapping. We therefore rely on `_getTwoTokenPoolBalances`.
        (, IERC20 tokenA, bytes32 balanceA, IERC20 tokenB, bytes32 balanceB) = _getTwoTokenPoolBalances(poolId);

        if (token == tokenA) {
            return balanceA;
        } else if (token == tokenB) {
            return balanceB;
        } else {
            _revert(Errors.TOKEN_NOT_REGISTERED);
        }
    }

    /**
     * @dev Returns the balance of the two tokens in a Two Token Pool.
     *
     * The returned balances are those of token A and token B, where token A is the lowest of token X and token Y, and
     * token B the other.
     *
     * This function also returns a storage pointer to the TwoTokenPoolBalances struct associated with the token pair,
     * which can be used to update it without having to recompute the pair hash and storage slot.
     *
     * Requirements:
     *
     * - `poolId` must be a Minimal Swap Info Pool
     * - `tokenX` and `tokenY` must be registered in the Pool
     */
    function _getTwoTokenPoolSharedBalances(
        bytes32 poolId,
        IERC20 tokenX,
        IERC20 tokenY
    )
        internal
        view
        returns (
            bytes32 balanceA,
            bytes32 balanceB,
            TwoTokenPoolBalances storage poolBalances
        )
    {
        (IERC20 tokenA, IERC20 tokenB) = _sortTwoTokens(tokenX, tokenY);
        bytes32 pairHash = _getTwoTokenPairHash(tokenA, tokenB);

        poolBalances = _twoTokenPoolTokens[poolId].balances[pairHash];

        // Because we're reading balances using the pair hash, if either token X or token Y is not registered then
        // *both* balance entries will be zero.
        bytes32 sharedCash = poolBalances.sharedCash;
        bytes32 sharedManaged = poolBalances.sharedManaged;

        // A non-zero balance guarantees that both tokens are registered. If zero, we manually check whether each
        // token is registered in the Pool. Token registration implies that the Pool is registered as well, which
        // lets us save gas by not performing the check.
        bool tokensRegistered = sharedCash.isNotZero() ||
            sharedManaged.isNotZero() ||
            (_isTwoTokenPoolTokenRegistered(poolId, tokenA) && _isTwoTokenPoolTokenRegistered(poolId, tokenB));

        if (!tokensRegistered) {
            // The tokens might not be registered because the Pool itself is not registered. We check this to provide a
            // more accurate revert reason.
            _ensureRegisteredPool(poolId);
            _revert(Errors.TOKEN_NOT_REGISTERED);
        }

        balanceA = BalanceAllocation.fromSharedToBalanceA(sharedCash, sharedManaged);
        balanceB = BalanceAllocation.fromSharedToBalanceB(sharedCash, sharedManaged);
    }

    /**
     * @dev Returns true if `token` is registered in a Two Token Pool.
     *
     * This function assumes `poolId` exists and corresponds to the Two Token specialization setting.
     */
    function _isTwoTokenPoolTokenRegistered(bytes32 poolId, IERC20 token) internal view returns (bool) {
        TwoTokenPoolTokens storage poolTokens = _twoTokenPoolTokens[poolId];

        // The zero address can never be a registered token.
        return (token == poolTokens.tokenA || token == poolTokens.tokenB) && token != IERC20(0);
    }

    /**
     * @dev Returns the hash associated with a given token pair.
     */
    function _getTwoTokenPairHash(IERC20 tokenA, IERC20 tokenB) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenA, tokenB));
    }

    /**
     * @dev Sorts two tokens in ascending order, returning them as a (tokenA, tokenB) tuple.
     */
    function _sortTwoTokens(IERC20 tokenX, IERC20 tokenY) private pure returns (IERC20, IERC20) {
        return tokenX < tokenY ? (tokenX, tokenY) : (tokenY, tokenX);
    }
}
