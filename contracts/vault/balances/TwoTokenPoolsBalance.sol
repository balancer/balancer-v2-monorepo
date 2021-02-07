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

pragma solidity ^0.7.1;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./BalanceAllocation.sol";

contract TwoTokenPoolsBalance {
    using BalanceAllocation for bytes32;

    // Data for Pools with Two Tokens
    //
    // These are similar to the Minimal Swap Info Pool case (because the Pool only has two tokens, and therefore there
    // are only two balances to read), but there's a key difference in how data is stored. Keeping a set makes little
    // sense, as it will only ever hold two tokens, so we can just store those two directly.
    // The gas savings associated with using these Pools come from how token balances are stored: cash for token A and
    // token B is packed together, as are external amounts. Because only cash changes in a swap, there's no need to
    // write to this second storage slot.
    // This however makes Vault code that interacts with these Pools cumbersome: both balances must be accessed at the
    // same time by using both token addresses, and some logic is needed to differentiate token A from token B. In this
    // case, token A is always the token with the lowest numerical address value. The token X and token Y names are used
    // in functions when it is unknown which one is A and which one is B.

    struct TwoTokenPoolBalances {
        bytes32 sharedCash;
        bytes32 sharedManaged;
    }

    struct TwoTokenPoolTokens {
        IERC20 tokenA;
        IERC20 tokenB;
        mapping(bytes32 => TwoTokenPoolBalances) balances;
    }

    // We could just keep a mapping from Pool ID to TwoTokenSharedBalances, but there's an issue: we wouldn't know to
    // which tokens those balances correspond. This would mean having to also check the tokens struct in a swap, to make
    // sure the tokens being swapped are the ones in the Pool.
    // What we do instead to save those storage reads is keep a nested mapping from token pair hash to the balances
    // struct. The Pool only has two tokens, so only a single entry of this mapping is set (the one that corresponds to
    // that pair's hash). This means queries for token pairs where any of the tokens is not in the Pool will generate a
    // hash for a mapping entry that was not set, containing zero balances. Non-zero balances are only possible if both
    // tokens in the pair are the Pool's tokens, which means we don't have to check the TwoTokensTokens struct and save
    // storage reads.
    mapping(bytes32 => TwoTokenPoolTokens) private _twoTokenPoolTokens;

    /**
     * @dev Registers the tokens of a Two Token Pool.
     *
     * Requirements:
     *
     * - `tokenX` and `tokenY` cannot be the same.
     * - Both tokens must not be the zero address.
     * - Both tokens must not be registered in the Pool.
     */
    function _registerTwoTokenPoolTokens(
        bytes32 poolId,
        IERC20 tokenX,
        IERC20 tokenY
    ) internal {
        require(tokenX != IERC20(0) && tokenY != IERC20(0), "ZERO_ADDRESS_TOKEN");

        // Not technically true since we didn't register yet, but this is consistent with the error messages of other
        // specialization settings.
        require(tokenX != tokenY, "TOKEN_ALREADY_REGISTERED");

        TwoTokenPoolTokens storage poolTokens = _twoTokenPoolTokens[poolId];
        require(poolTokens.tokenA == IERC20(0) && poolTokens.tokenB == IERC20(0), "TOKENS_ALREADY_SET");

        (IERC20 tokenA, IERC20 tokenB) = _sortTwoTokens(tokenX, tokenY);
        poolTokens.tokenA = tokenA;
        poolTokens.tokenB = tokenB;
    }

    /**
     * @dev Deregisters the tokens of a Two Token Pool.
     *
     * Requirements:
     *
     * - `tokenX` and `tokenY` must be the Pool's tokens.
     * - Both tokens must have non balance in the Vault.
     */
    function _deregisterTwoTokenPoolTokens(
        bytes32 poolId,
        IERC20 tokenX,
        IERC20 tokenY
    ) internal {
        (bytes32 balanceA, bytes32 balanceB, ) = _getTwoTokenPoolSharedBalances(poolId, tokenX, tokenY);
        require(balanceA.isZero() && balanceB.isZero(), "NONZERO_TOKEN_BALANCE");

        delete _twoTokenPoolTokens[poolId];
        // No need to delete the balance entries, since they already are zero
    }

    /**
     * @dev This setter is only used when adding/removing liquidity, where tokens are guaranteed to be ordered and
     * registered. These methods actually fetch the tokens from `_getTwoTokenPoolTokens` first.
     */
    function _setTwoTokenPoolCashBalances(
        bytes32 poolId,
        IERC20 tokenA,
        bytes32 balanceA,
        IERC20 tokenB,
        bytes32 balanceB
    ) internal {
        bytes32 hash = _getTwoTokenPairHash(tokenA, tokenB);
        TwoTokenPoolBalances storage poolBalances = _twoTokenPoolTokens[poolId].balances[hash];
        poolBalances.sharedCash = BalanceAllocation.toSharedCash(balanceA, balanceB);
    }

    function _twoTokenPoolCashToManaged(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateTwoTokenPoolSharedBalance(poolId, token, BalanceAllocation.cashToManaged, amount);
    }

    function _twoTokenPoolManagedToCash(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateTwoTokenPoolSharedBalance(poolId, token, BalanceAllocation.managedToCash, amount);
    }

    function _setTwoTokenPoolManagedBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateTwoTokenPoolSharedBalance(poolId, token, BalanceAllocation.setManaged, amount);
    }

    function _updateTwoTokenPoolSharedBalance(
        bytes32 poolId,
        IERC20 token,
        function(bytes32, uint256) pure returns (bytes32) mutation,
        uint256 amount
    ) private {
        (
            TwoTokenPoolBalances storage balances,
            IERC20 tokenA,
            bytes32 balanceA,
            IERC20 tokenB,
            bytes32 balanceB
        ) = _getTwoTokenPoolBalances(poolId);

        if (token == tokenA) {
            balanceA = mutation(balanceA, amount);
        } else if (token == tokenB) {
            balanceB = mutation(balanceB, amount);
        } else {
            revert("TOKEN_NOT_REGISTERED");
        }

        balances.sharedCash = BalanceAllocation.toSharedCash(balanceA, balanceB);
        balances.sharedManaged = BalanceAllocation.toSharedManaged(balanceA, balanceB);
    }

    /**
     * @dev Returns the balance for a token pair in a Two Token Pool, reverting if either of the tokens is
     * not registered by the Pool.
     *
     * The returned balances are those of token A and token B, where token A is the lowest of token X and token Y, and
     * token B the other.
     *
     * This function also returns a storage pointer to the TwoTokenSharedBalances entry associated with the token pair,
     * which can be used to update this entry without having to recompute the pair hash and storage slot.
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

        bytes32 sharedCash = poolBalances.sharedCash;
        bytes32 sharedManaged = poolBalances.sharedManaged;

        // Only registered tokens can have non-zero balances, so we can use this as a shortcut to avoid the
        // expensive _hasPoolTwoTokens check.
        bool exists = sharedCash.isNotZero() || sharedManaged.isNotZero() || _hasPoolTwoTokens(poolId, tokenA, tokenB);
        require(exists, "TOKEN_NOT_REGISTERED");

        balanceA = BalanceAllocation.fromSharedToBalanceA(sharedCash, sharedManaged);
        balanceB = BalanceAllocation.fromSharedToBalanceB(sharedCash, sharedManaged);
    }

    /**
     * @dev Returns an array with all the tokens and balances in a Two Token Pool.
     * This array will have either two or zero entries (if the Pool doesn't have any tokens).
     */
    function _getTwoTokenPoolTokens(bytes32 poolId)
        internal
        view
        returns (IERC20[] memory tokens, bytes32[] memory balances)
    {
        (, IERC20 tokenA, bytes32 balanceA, IERC20 tokenB, bytes32 balanceB) = _getTwoTokenPoolBalances(poolId);

        // Both tokens will either be zero or non-zero, but we keep the full check for clarity
        if (tokenA == IERC20(0) || tokenB == IERC20(0)) {
            return (new IERC20[](0), new bytes32[](0));
        }

        // Note that functions relying on this getter expect tokens to be properly ordered, so it's extremely important
        // to always return (A,B)

        tokens = new IERC20[](2);
        tokens[0] = tokenA;
        tokens[1] = tokenB;

        balances = new bytes32[](2);
        balances[0] = balanceA;
        balances[1] = balanceB;
    }

    /**
     * @dev Returns the balance for a token in a Two Token Pool.
     *
     * This function is convenient but not particularly gas efficient, and should be avoided during gas-sensitive
     * operations, such as swaps. For those, _getTwoTokenPoolSharedBalances provides a more flexible interface.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     */
    function _getTwoTokenPoolBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32 balance) {
        // We can't just read the balance of token, because we need to know the full pair in order to compute the pair
        // hash and access the balance mapping. We therefore also read the TwoTokenPoolTokens struct.
        (, IERC20 tokenA, bytes32 balanceA, IERC20 tokenB, bytes32 balanceB) = _getTwoTokenPoolBalances(poolId);

        if (token == tokenA) {
            return balanceA;
        } else if (token == tokenB) {
            return balanceB;
        } else {
            revert("TOKEN_NOT_REGISTERED");
        }
    }

    function _hasPoolTwoTokens(
        bytes32 poolId,
        IERC20 tokenA,
        IERC20 tokenB
    ) internal view returns (bool) {
        TwoTokenPoolTokens storage poolTokens = _twoTokenPoolTokens[poolId];
        return poolTokens.tokenA == tokenA && tokenB == poolTokens.tokenB;
    }

    function _isTwoTokenPoolTokenRegistered(bytes32 poolId, IERC20 token) internal view returns (bool) {
        TwoTokenPoolTokens storage poolTokens = _twoTokenPoolTokens[poolId];
        return (token == poolTokens.tokenA || token == poolTokens.tokenB) && token != IERC20(0);
    }

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
     * @dev Returns a hash associated with a given token pair.
     */
    function _getTwoTokenPairHash(IERC20 tokenA, IERC20 tokenB) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenA, tokenB));
    }

    /**
     * @dev Sorts two tokens ascendingly, returning them as a (tokenA, tokenB) tuple.
     */
    function _sortTwoTokens(IERC20 tokenX, IERC20 tokenY) private pure returns (IERC20, IERC20) {
        return tokenX < tokenY ? (tokenX, tokenY) : (tokenY, tokenX);
    }
}
