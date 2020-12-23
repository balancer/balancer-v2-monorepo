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

import "hardhat/console.sol";

import "../../math/FixedPoint.sol";

import "../IVault.sol";
import "./CashInvested.sol";

contract TwoTokenPoolsBalance {
    using CashInvested for bytes32;

    // Data for Pools with Two Tokens
    //
    // These are similar to Pair Pools case (because the Pool only has two tokens, and therefore there are only two
    // balances to read), but there's a key difference in how data is stored. Keeping a set makes little sense, as it
    // will only ever hold two tokens, so we can just store those two directly.
    // The gas savings associated with using these Pools come from how token balances are stored: cash for token A and
    // token B is packed together, as are invested amounts. Because only cash changes in a swap, there's no need to
    // write to this second storage slot.
    // This however makes Vault code that interacts with these Pools cumbersome: both balances must be accessed at the
    // same time by using both token addresses, and some logic is needed to differentiate token A from token B. In this
    // case, token A is always the token with the lowest numerical address value. The token X and token Y names are used
    // in functions when it is unknown which one is A and which one is B.

    /**
     * @dev Sorts two tokens ascendingly, returning them as a (tokenA, tokenB) tuple.
     */
    function _sortTwoTokens(IERC20 tokenX, IERC20 tokenY) private pure returns (IERC20, IERC20) {
        return tokenX < tokenY ? (tokenX, tokenY) : (tokenY, tokenX);
    }

    /**
     * @dev Returns a hash associated with a given token pair. Each pair has a unique hash, regardless of which one is
     * token X and token Y.
     */
    function _getTwoTokenPairHash(IERC20 tokenX, IERC20 tokenY) private pure returns (bytes32) {
        (IERC20 tokenA, IERC20 tokenB) = _sortTwoTokens(tokenX, tokenY);
        return keccak256(abi.encodePacked(tokenA, tokenB));
    }

    struct TwoTokenTokens {
        IERC20 tokenA;
        IERC20 tokenB;
    }

    struct TwoTokenSharedBalances {
        bytes32 sharedCash;
        bytes32 sharedInvested;
    }

    mapping(bytes32 => TwoTokenTokens) internal _poolTwoTokenTokens;

    // We could just keep a mapping from Pool ID to TwoTokenSharedBalances, but there's an issue: we wouldn't know to
    // which tokens those balances correspond. This would mean having to also check the tokens struct in a swap, to make
    // sure the tokens being swapped are the ones in the Pool.
    // What we do instead to save those storage reads is keep a nested mapping from token pair hash to the balances
    // struct. The Pool only has two tokens, so only a single entry of this mapping is set (the one that correspond's to
    // that pair's hash). This means queries for token pairs where any of the tokens is not in the Pool will generate a
    // hash for a mapping entry that was not set, containing zero balances. Non-zero balances are only possible if both
    // tokens in the pair are the Pool's tokens, which means we don't have to check the TwoTokensTokens struct and save
    // storage reads.
    mapping(bytes32 => mapping(bytes32 => TwoTokenSharedBalances)) internal _poolTwoTokenSharedBalancess;

    /**
     * @dev Returns an array with all the tokens in a Two Token Pool. This array will have either two or zero entries
     * (if the Pool doesn't have any tokens).
     */
    function _getTwoTokenPoolTokens(bytes32 poolId) internal view returns (IERC20[] memory) {
        TwoTokenTokens memory poolTokens = _poolTwoTokenTokens[poolId];

        IERC20[] memory tokens;
        // Both tokens will either be zero or non-zero, but we keep the full check for clarity
        if (poolTokens.tokenA != IERC20(0) && poolTokens.tokenB != IERC20(0)) {
            tokens = new IERC20[](2);
            tokens[0] = poolTokens.tokenA;
            tokens[1] = poolTokens.tokenB;
        } else {
            tokens = new IERC20[](0);
        }

        return tokens;
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
    function _getTwoTokenPoolBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        // We can't just read the balance of token, because we need to know the full pair in order to compute the pair
        // hash and access the balance mapping. We therefore also read the TwoTokenTokens struct.

        TwoTokenTokens memory poolTokens = _poolTwoTokenTokens[poolId];

        (bytes32 tokenABalance, bytes32 tokenBBalance, ) = _getTwoTokenPoolSharedBalances(
            poolId,
            poolTokens.tokenA,
            poolTokens.tokenB
        );

        if (token == poolTokens.tokenA) {
            return tokenABalance;
        } else if (token == poolTokens.tokenB) {
            return tokenBBalance;
        } else {
            revert("Token not in pool");
        }
    }

    /**
     * @dev Returns the balance for a token pair in a Two Token Pool. This doesn't check for token existence: if the
     * tokens are not in the Pool, it will simply return balances of zero (for both tokens, even if one of them is in
     * the Pool).
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
            bytes32 tokenABalance,
            bytes32 tokenBBalance,
            TwoTokenSharedBalances storage poolSharedBalance
        )
    {
        bytes32 pairHash = _getTwoTokenPairHash(tokenX, tokenY);
        poolSharedBalance = _poolTwoTokenSharedBalancess[poolId][pairHash];

        bytes32 sharedCash = poolSharedBalance.sharedCash;
        bytes32 sharedInvested = poolSharedBalance.sharedInvested;

        tokenABalance = CashInvested.fromSharedToBalanceA(sharedCash, sharedInvested);
        tokenBBalance = CashInvested.fromSharedToBalanceB(sharedCash, sharedInvested);
    }

    /**
     * @dev Adds cash to a Two Token Pool for two tokens. If the Pool didn't originally have tokens, they are added to
     * it.
     *
     * Requirements:
     *
     * - `tokenX` and `tokenY` must not be the same.
     * - if the Pool has no tokens, `amountX` and `amountY` must be non-zero.
     * - if the Pool already has two tokens, `tokenX` and `tokenY` must be those tokens.
     */
    function _increaseTwoTokenPoolCash(
        bytes32 poolId,
        IERC20 tokenX,
        uint128 amountX,
        IERC20 tokenY,
        uint128 amountY
    ) internal {
        require(tokenX != tokenY, "Tokens are the same");

        TwoTokenTokens memory poolTokens = _poolTwoTokenTokens[poolId];

        if (poolTokens.tokenA != IERC20(0) || poolTokens.tokenB != IERC20(0)) {
            // Pool is already initialized - check the tokens are the same
            require((tokenX == poolTokens.tokenA) || (tokenX == poolTokens.tokenB), "Adding to token not in pool");
            require((tokenY == poolTokens.tokenA) || (tokenY == poolTokens.tokenB), "Adding to token not in pool");
        } else {
            // Initialize pool
            require(amountX != 0 && amountY != 0, "New token amount is zero");

            (IERC20 tokenA, IERC20 tokenB) = _sortTwoTokens(tokenX, tokenY);
            _poolTwoTokenTokens[poolId] = TwoTokenTokens({ tokenA: tokenA, tokenB: tokenB });
        }

        (
            bytes32 tokenABalance,
            bytes32 tokenBBalance,
            TwoTokenSharedBalances storage poolSharedBalances
        ) = _getTwoTokenPoolSharedBalances(poolId, tokenX, tokenY);

        if (tokenX < tokenY) {
            // X is A, Y is B
            tokenABalance = tokenABalance.increaseCash(amountX);
            tokenBBalance = tokenBBalance.increaseCash(amountY);
        } else {
            // X is B, Y is A
            tokenABalance = tokenABalance.increaseCash(amountY);
            tokenBBalance = tokenBBalance.increaseCash(amountX);
        }

        poolSharedBalances.sharedCash = CashInvested.toSharedCash(tokenABalance, tokenBBalance);
        // We don't need to write to the sharedInvested entry, since it is already initialized with zeroes
    }

    /**
     * @dev Removes cash from a Two Token Pool for its two tokens. If this fully drains the Pool's balance for both
     * tokens (including invested balance), then they are removed from the Pool. A single token cannot be removed from
     * the pool.
     *
     * Requirements:
     *
     * - `tokenX` and `tokenY` must be the Pool's tokens.
     * - `amountX` and `amountY` must be less or equal than the Pool's cash for the respective token.
     */
    function _decreaseTwoTokenPoolCash(
        bytes32 poolId,
        IERC20 tokenX,
        uint128 amountX,
        IERC20 tokenY,
        uint128 amountY
    ) internal {
        TwoTokenTokens memory poolTokens = _poolTwoTokenTokens[poolId];

        (IERC20 tokenA, IERC20 tokenB) = _sortTwoTokens(tokenX, tokenY);
        require(poolTokens.tokenA == tokenA, "Token not in pool");
        require(poolTokens.tokenB == tokenB, "Token not in pool");

        (
            bytes32 tokenABalance,
            bytes32 tokenBBalance,
            TwoTokenSharedBalances storage poolSharedBalances
        ) = _getTwoTokenPoolSharedBalances(poolId, tokenX, tokenY);

        if (tokenX < tokenY) {
            // X is A, Y is B
            tokenABalance = tokenABalance.decreaseCash(amountX);
            tokenBBalance = tokenBBalance.decreaseCash(amountY);
        } else {
            // X is B, Y is A
            tokenABalance = tokenABalance.decreaseCash(amountY);
            tokenBBalance = tokenBBalance.decreaseCash(amountX);
        }

        poolSharedBalances.sharedCash = CashInvested.toSharedCash(tokenABalance, tokenBBalance);

        if (tokenABalance.total() == 0 && tokenBBalance.total() == 0) {
            delete _poolTwoTokenTokens[poolId];
        } else {
            // Neither can be zero
            require(tokenABalance.total() != 0 && tokenBBalance.total() != 0, "Cannot fully remove single token");
        }
    }
}
