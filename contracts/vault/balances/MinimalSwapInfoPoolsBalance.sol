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

contract MinimalSwapInfoPoolsBalance {
    using BalanceAllocation for bytes32;

    // Data for Pools with Minimal Swap Info Specialization setting
    //
    // These Pools use the IMinimalSwapInfoPoolQuote interface, and so the Vault must read the balance of the two tokens
    // in the swap. The best solution is to use a mapping from token to balance, which lets us read or write any token's
    // balance in a single storage access.
    // We also keep a set with all tokens in the Pool, and update this set when cash is added or removed from the pool.
    // Tokens in the set always have a non-zero balance, so we don't need
    // to check the set for token existence during a swap: the non-zero balance check achieves this for less gas.

    struct MinimalSwapInfoPoolTokenInfo {
        bool registered;
        bytes32 balance;
    }

    struct MinimalSwapInfoPoolTokens {
        uint256 totalTokens;
        mapping(uint256 => IERC20) tokens;
        mapping(IERC20 => MinimalSwapInfoPoolTokenInfo) info;
    }

    mapping(bytes32 => MinimalSwapInfoPoolTokens) internal _minimalSwapInfoPoolTokens;

    /**
     * @dev Registers a list of tokens in a Minimal Swap Info Pool.
     *
     * Requirements:
     *
     * - Each token must not be the zero address.
     * - Each token must not be registered in the Pool.
     */
    function _registerMinimalSwapInfoPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        MinimalSwapInfoPoolTokens storage poolTokens = _minimalSwapInfoPoolTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            MinimalSwapInfoPoolTokenInfo storage tokenInfo = poolTokens.info[token];

            require(token != IERC20(0), "ZERO_ADDRESS_TOKEN");
            require(!tokenInfo.registered, "TOKEN_ALREADY_REGISTERED");

            poolTokens.tokens[poolTokens.totalTokens++] = token;
            tokenInfo.registered = true;
        }
    }

    /**
     * @dev Unregisters a list of tokens in a Minimal Swap Info Pool.
     *
     * Requirements:
     *
     * - Each token must be registered in the Pool.
     * - Each token must have non balance in the Vault.
     */
    function _unregisterMinimalSwapInfoPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        MinimalSwapInfoPoolTokens storage poolTokens = _minimalSwapInfoPoolTokens[poolId];
        uint256 totalTokens = poolTokens.totalTokens;

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            MinimalSwapInfoPoolTokenInfo storage tokenInfo = poolTokens.info[token];

            require(tokenInfo.registered, "TOKEN_NOT_REGISTERED");
            require(tokenInfo.balance.isZero(), "NONZERO_TOKEN_BALANCE");

            tokenInfo.registered = false;
            // No need to delete the balance entries, since they already are zero

            uint256 tokenIndex = 0;
            for (uint256 j = 0; j < totalTokens; j++) {
                if (poolTokens.tokens[j] == token) {
                    tokenIndex = j;
                    break;
                }
            }

            totalTokens--;
            poolTokens.tokens[tokenIndex] = poolTokens.tokens[totalTokens];
            delete poolTokens.tokens[totalTokens];
        }

        poolTokens.totalTokens = totalTokens;
    }

    function _setMinimalSwapInfoPoolBalances(
        bytes32 poolId,
        IERC20[] memory tokens,
        bytes32[] memory balances
    ) internal {
        MinimalSwapInfoPoolTokens storage poolTokens = _minimalSwapInfoPoolTokens[poolId];
        for (uint256 i = 0; i < tokens.length; ++i) {
            poolTokens.info[tokens[i]].balance = balances[i];
        }
    }

    function _minimalSwapInfoPoolCashToManaged(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateMinimalSwapInfoPoolBalance(poolId, token, BalanceAllocation.cashToManaged, amount);
    }

    function _minimalSwapInfoPoolManagedToCash(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateMinimalSwapInfoPoolBalance(poolId, token, BalanceAllocation.managedToCash, amount);
    }

    function _setMinimalSwapInfoPoolManagedBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateMinimalSwapInfoPoolBalance(poolId, token, BalanceAllocation.setManaged, amount);
    }

    function _updateMinimalSwapInfoPoolBalance(
        bytes32 poolId,
        IERC20 token,
        function(bytes32, uint256) pure returns (bytes32) mutation,
        uint256 amount
    ) internal {
        MinimalSwapInfoPoolTokenInfo storage tokenInfo = _minimalSwapInfoPoolTokens[poolId].info[token];
        bytes32 currentBalance = _getMinimalSwapInfoPoolBalance(tokenInfo);
        tokenInfo.balance = mutation(currentBalance, amount);
    }

    /**
     * @dev Returns an array with all the tokens and balances in a Minimal Swap Info Pool.
     * This order may change when tokens are added to or removed from the Pool.
     */
    function _getMinimalSwapInfoPoolTokens(bytes32 poolId)
        internal
        view
        returns (IERC20[] memory tokens, bytes32[] memory balances)
    {
        MinimalSwapInfoPoolTokens storage poolTokens = _minimalSwapInfoPoolTokens[poolId];
        tokens = new IERC20[](poolTokens.totalTokens);
        balances = new bytes32[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = poolTokens.tokens[i];
            tokens[i] = token;
            balances[i] = poolTokens.info[token].balance;
        }
    }

    /**
     * @dev Returns the balance for a token in a Minimal Swap Info Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     */
    function _getMinimalSwapInfoPoolBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        MinimalSwapInfoPoolTokenInfo storage tokenInfo = _minimalSwapInfoPoolTokens[poolId].info[token];
        return _getMinimalSwapInfoPoolBalance(tokenInfo);
    }

    function _getMinimalSwapInfoPoolBalance(MinimalSwapInfoPoolTokenInfo storage tokenInfo)
        internal
        view
        returns (bytes32)
    {
        bytes32 balance = tokenInfo.balance;
        bool existsToken = balance.isNotZero() || tokenInfo.registered;
        require(existsToken, "TOKEN_NOT_REGISTERED");
        return balance;
    }

    function _isMinimalSwapInfoPoolTokenRegistered(bytes32 poolId, IERC20 token) internal view returns (bool) {
        MinimalSwapInfoPoolTokenInfo storage tokenInfo = _minimalSwapInfoPoolTokens[poolId].info[token];
        return tokenInfo.registered;
    }
}
