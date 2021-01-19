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

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../math/FixedPoint.sol";

import "./BalanceAllocation.sol";

contract TwoTokenPoolsBalance {
    using SafeCast for uint256;
    using FixedPoint for int256;
    using BalanceAllocation for bytes32;

    // Data for Pools with Two Tokens
    //
    // These are similar to the Simplified Quote Pool case (because the Pool only has two tokens, and therefore there
    // are only two balances to read), but there's a key difference in how data is stored. Keeping a set makes little
    // sense, as it will only ever hold two tokens, so we can just store those two directly.
    // The gas savings associated with using these Pools come from how token balances are stored: cash for token A and
    // token B is packed together, as are external amounts. Because only cash changes in a swap, there's no need to
    // write to this second storage slot.
    // This however makes Vault code that interacts with these Pools cumbersome: both balances must be accessed at the
    // same time by using both token addresses, and some logic is needed to differentiate token A from token B. In this
    // case, token A is always the token with the lowest numerical address value. The token X and token Y names are used
    // in functions when it is unknown which one is A and which one is B.

    struct TwoTokenTokens {
        IERC20 tokenA;
        IERC20 tokenB;
    }

    struct TwoTokenSharedBalances {
        bytes32 sharedCash;
        bytes32 sharedManaged;
    }

    mapping(bytes32 => TwoTokenTokens) internal _poolTwoTokenTokens;

    // We could just keep a mapping from Pool ID to TwoTokenSharedBalances, but there's an issue: we wouldn't know to
    // which tokens those balances correspond. This would mean having to also check the tokens struct in a swap, to make
    // sure the tokens being swapped are the ones in the Pool.
    // What we do instead to save those storage reads is keep a nested mapping from token pair hash to the balances
    // struct. The Pool only has two tokens, so only a single entry of this mapping is set (the one that corresponds to
    // that pair's hash). This means queries for token pairs where any of the tokens is not in the Pool will generate a
    // hash for a mapping entry that was not set, containing zero balances. Non-zero balances are only possible if both
    // tokens in the pair are the Pool's tokens, which means we don't have to check the TwoTokensTokens struct and save
    // storage reads.
    mapping(bytes32 => mapping(bytes32 => TwoTokenSharedBalances)) internal _poolTwoTokenSharedBalances;

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
        bytes32 pairHash = _getTwoTokenPairHash(poolTokens.tokenA, poolTokens.tokenB);
        TwoTokenSharedBalances storage poolSharedBalance = _poolTwoTokenSharedBalances[poolId][pairHash];

        bytes32 sharedCash = poolSharedBalance.sharedCash;
        bytes32 sharedManaged = poolSharedBalance.sharedManaged;

        if (token == poolTokens.tokenA) {
            return BalanceAllocation.fromSharedToBalanceA(sharedCash, sharedManaged);
        } else if (token == poolTokens.tokenB) {
            return BalanceAllocation.fromSharedToBalanceB(sharedCash, sharedManaged);
        } else {
            revert("ERR_TOKEN_NOT_REGISTERED");
        }
    }

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
        require(tokenX != tokenY, "ERR_TOKENS_ARE_THE_SAME");
        require(tokenX != IERC20(0) && tokenY != IERC20(0), "ERR_TOKEN_IS_ZERO");

        TwoTokenTokens memory poolTokens = _poolTwoTokenTokens[poolId];
        require(poolTokens.tokenA == IERC20(0) && poolTokens.tokenB == IERC20(0), "ERR_TOKENS_ALREADY_SET");

        (IERC20 tokenA, IERC20 tokenB) = _sortTwoTokens(tokenX, tokenY);
        _poolTwoTokenTokens[poolId] = TwoTokenTokens({ tokenA: tokenA, tokenB: tokenB });
    }

    /**
     * @dev Unregisters the tokens of a Two Token Pool.
     *
     * Requirements:
     *
     * - `tokenX` and `tokenY` must be the Pool's tokens.
     * - Both tokens must have non balance in the Vault.
     */
    function _unregisterTwoTokenPoolTokens(
        bytes32 poolId,
        IERC20 tokenX,
        IERC20 tokenY
    ) internal {
        (bytes32 tokenABalance, bytes32 tokenBBalance, ) = _getTwoTokenPoolSharedBalances(poolId, tokenX, tokenY);
        require(tokenABalance.isZero() && tokenBBalance.isZero(), "ERR_TOKEN_BALANCE_IS_NOT_ZERO");

        delete _poolTwoTokenTokens[poolId];
        // No need to delete the balance entries, since they already are zero
    }

    /**
     * @dev Adds cash to a Two Token Pool.
     *
     * Requirements:
     *
     * - `tokenX` and `tokenY` must be the Pool's tokens.
     */
    function _increaseTwoTokenPoolCash(
        bytes32 poolId,
        IERC20 tokenX,
        uint128 amountX,
        IERC20 tokenY,
        uint128 amountY
    ) internal {
        _updateTwoTokenPoolCashTokenBalance(poolId, tokenX, amountX, tokenY, amountY, BalanceAllocation.increaseCash);
    }

    function _alterTwoTokenPoolCash(
        bytes32 poolId,
        IERC20 tokenX,
        int256 amountX,
        IERC20 tokenY,
        int256 amountY
    ) internal {
        _updateTwoTokenPoolCashTokenBalance(
            poolId,
            tokenX,
            amountX.abs().toUint128(),
            amountX > 0 ? BalanceAllocation.increaseCash : BalanceAllocation.decreaseCash,
            tokenY,
            amountY.abs().toUint128(),
            amountY > 0 ? BalanceAllocation.increaseCash : BalanceAllocation.decreaseCash
        );
    }

    /**
     * @dev Removes cash from a Two Token Pool.
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
        _updateTwoTokenPoolCashTokenBalance(poolId, tokenX, amountX, tokenY, amountY, BalanceAllocation.decreaseCash);
    }

    function _twoTokenPoolCashToManaged(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updateTwoTokenPoolSharedTokenBalance(poolId, token, BalanceAllocation.cashToManaged, amount);
    }

    function _twoTokenPoolManagedToCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updateTwoTokenPoolSharedTokenBalance(poolId, token, BalanceAllocation.managedToCash, amount);
    }

    function _setTwoTokenPoolManagedBalance(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        _updateTwoTokenPoolSharedTokenBalance(poolId, token, BalanceAllocation.setManagedBalance, amount);
    }

    function _updateTwoTokenPoolCashTokenBalance(
        bytes32 poolId,
        IERC20 tokenX,
        uint128 amountX,
        IERC20 tokenY,
        uint128 amountY,
        function(bytes32, uint128) pure returns (bytes32) mutation
    ) private {
        (
            bytes32 tokenABalance,
            bytes32 tokenBBalance,
            TwoTokenSharedBalances storage poolSharedBalances
        ) = _getTwoTokenPoolSharedBalances(poolId, tokenX, tokenY);

        if (tokenX < tokenY) {
            // X is A, Y is B
            tokenABalance = mutation(tokenABalance, amountX);
            tokenBBalance = mutation(tokenBBalance, amountY);
        } else {
            // X is B, Y is A
            tokenABalance = mutation(tokenABalance, amountY);
            tokenBBalance = mutation(tokenBBalance, amountX);
        }

        poolSharedBalances.sharedCash = BalanceAllocation.toSharedCash(tokenABalance, tokenBBalance);
        // We don't need to write to the sharedManaged entry
    }

    function _updateTwoTokenPoolCashTokenBalance(
        bytes32 poolId,
        IERC20 tokenX,
        uint128 amountX,
        function(bytes32, uint128) pure returns (bytes32) mutationX,
        IERC20 tokenY,
        uint128 amountY,
        function(bytes32, uint128) pure returns (bytes32) mutationY
    ) private {
        (
            bytes32 tokenABalance,
            bytes32 tokenBBalance,
            TwoTokenSharedBalances storage poolSharedBalances
        ) = _getTwoTokenPoolSharedBalances(poolId, tokenX, tokenY);

        if (tokenX < tokenY) {
            // X is A, Y is B
            tokenABalance = mutationX(tokenABalance, amountX);
            tokenBBalance = mutationY(tokenBBalance, amountY);
        } else {
            // X is B, Y is A
            tokenABalance = mutationY(tokenABalance, amountY);
            tokenBBalance = mutationX(tokenBBalance, amountX);
        }

        poolSharedBalances.sharedCash = BalanceAllocation.toSharedCash(tokenABalance, tokenBBalance);
        // We don't need to write to the sharedManaged entry
    }

    function _updateTwoTokenPoolSharedTokenBalance(
        bytes32 poolId,
        IERC20 token,
        function(bytes32, uint128) pure returns (bytes32) mutation,
        uint128 amount
    ) private {
        TwoTokenTokens memory poolTokens = _poolTwoTokenTokens[poolId];
        bytes32 pairHash = keccak256(abi.encodePacked(poolTokens.tokenA, poolTokens.tokenB));
        TwoTokenSharedBalances storage poolSharedBalances = _poolTwoTokenSharedBalances[poolId][pairHash];

        bytes32 sharedCash = poolSharedBalances.sharedCash;
        bytes32 sharedManaged = poolSharedBalances.sharedManaged;

        bytes32 tokenABalance = BalanceAllocation.fromSharedToBalanceA(sharedCash, sharedManaged);
        bytes32 tokenBBalance = BalanceAllocation.fromSharedToBalanceB(sharedCash, sharedManaged);

        if (token == poolTokens.tokenA) {
            tokenABalance = mutation(tokenABalance, amount);
        } else if (token == poolTokens.tokenB) {
            tokenBBalance = mutation(tokenBBalance, amount);
        } else {
            revert("ERR_TOKEN_NOT_REGISTERED");
        }

        poolSharedBalances.sharedCash = BalanceAllocation.toSharedCash(tokenABalance, tokenBBalance);
        poolSharedBalances.sharedManaged = BalanceAllocation.toSharedManaged(tokenABalance, tokenBBalance);
    }

    function _twoTokenPoolIsManaged(bytes32 poolId, IERC20 token) internal view returns (bool) {
        bytes32 currentBalance = _getTwoTokenPoolBalance(poolId, token);
        return currentBalance.isManaged();
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
            TwoTokenSharedBalances storage poolSharedBalances
        )
    {
        (IERC20 tokenA, IERC20 tokenB) = _sortTwoTokens(tokenX, tokenY);
        bytes32 pairHash = _getTwoTokenPairHash(tokenA, tokenB);
        poolSharedBalances = _poolTwoTokenSharedBalances[poolId][pairHash];

        bytes32 sharedCash = poolSharedBalances.sharedCash;
        bytes32 sharedManaged = poolSharedBalances.sharedManaged;
        bool exists = sharedCash.isNotZero() || sharedManaged.isNotZero() || _hasPoolTwoTokens(poolId, tokenA, tokenB);
        require(exists, "ERR_TOKEN_NOT_REGISTERED");

        tokenABalance = BalanceAllocation.fromSharedToBalanceA(sharedCash, sharedManaged);
        tokenBBalance = BalanceAllocation.fromSharedToBalanceB(sharedCash, sharedManaged);
    }

    function _hasPoolTwoTokens(
        bytes32 poolId,
        IERC20 tokenA,
        IERC20 tokenB
    ) internal view returns (bool) {
        TwoTokenTokens memory poolTokens = _poolTwoTokenTokens[poolId];
        return poolTokens.tokenA == tokenA && tokenB == poolTokens.tokenB;
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
