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

contract GeneralPoolsBalance {
    using BalanceAllocation for bytes32;

    // Data for Pools with General Pool Specialization setting
    //
    // These Pools use the IGeneralPoolQuote interface, which means the Vault must query the balance for *all* of their
    // tokens in every swap. If we kept a mapping of token to balance plus a set (array) of tokens, it'd be very gas
    // intensive to read all token addresses just to then do a lookup on the balance mapping.
    // Instead, we use a custom enumerable map, which lets us read the N balances in N+1 storage accesses (one for
    // the number of tokens in the Pool), as well as access the index of any token in a single read (required for the
    // IGeneralPoolQuote call) and update an entry's value given its index.

    struct GeneralPoolTokenInfo {
        IERC20 token;
        bytes32 balance;
    }

    struct GeneralPoolTokens {
        uint256 totalTokens;
        mapping(IERC20 => uint256) indices;
        mapping(uint256 => GeneralPoolTokenInfo) info;
    }

    mapping(bytes32 => GeneralPoolTokens) internal _generalPoolTokens;

    /**
     * @dev Registers a list of tokens in a General Pool.
     *
     * Requirements:
     *
     * - Each token must not be the zero address.
     * - Each token must not be registered in the Pool.
     */
    function _registerGeneralPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        GeneralPoolTokens storage poolTokens = _generalPoolTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            require(token != IERC20(0), "ZERO_ADDRESS_TOKEN");
            require(poolTokens.indices[token] == 0, "TOKEN_ALREADY_REGISTERED");

            uint256 tokenIndex = poolTokens.totalTokens++;
            poolTokens.indices[token] = tokenIndex + 1;
            poolTokens.info[tokenIndex].token = token;
        }
    }

    /**
     * @dev Unregisters a list of tokens in a General Pool.
     *
     * Requirements:
     *
     * - Each token must be registered in the Pool.
     * - Each token must have non balance in the Vault.
     */
    function _unregisterGeneralPoolTokens(bytes32 poolId, IERC20[] memory tokens) internal {
        GeneralPoolTokens storage poolTokens = _generalPoolTokens[poolId];
        uint256 totalTokens = poolTokens.totalTokens;

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            uint256 tokenIndex = _getGeneralPoolBalanceTokenIndex(poolTokens, token);

            GeneralPoolTokenInfo storage tokenInfo = poolTokens.info[tokenIndex];
            require(tokenInfo.balance.isZero(), "NONZERO_TOKEN_BALANCE");

            delete poolTokens.indices[token];
            delete tokenInfo.token;
            // No need to delete the balance entries, since they already are zero

            totalTokens--;
            GeneralPoolTokenInfo storage lastTokenInfo = poolTokens.info[totalTokens];
            poolTokens.indices[lastTokenInfo.token] = tokenIndex + 1;
            poolTokens.info[tokenIndex] = lastTokenInfo;
        }

        poolTokens.totalTokens = totalTokens;
    }

    function _setGeneralPoolBalances(bytes32 poolId, bytes32[] memory balances) internal {
        GeneralPoolTokens storage poolTokens = _generalPoolTokens[poolId];
        for (uint256 i = 0; i < balances.length; ++i) {
            poolTokens.info[i].balance = balances[i];
        }
    }

    function _generalPoolCashToManaged(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateGeneralPoolBalance(poolId, token, BalanceAllocation.cashToManaged, amount);
    }

    function _generalPoolManagedToCash(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateGeneralPoolBalance(poolId, token, BalanceAllocation.managedToCash, amount);
    }

    function _setGeneralPoolManagedBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) internal {
        _updateGeneralPoolBalance(poolId, token, BalanceAllocation.setManaged, amount);
    }

    function _updateGeneralPoolBalance(
        bytes32 poolId,
        IERC20 token,
        function(bytes32, uint256) pure returns (bytes32) mutation,
        uint256 amount
    ) internal {
        GeneralPoolTokenInfo storage tokenInfo = _getGeneralPoolTokenInfo(poolId, token);
        bytes32 currentBalance = tokenInfo.balance;
        tokenInfo.balance = mutation(currentBalance, amount);
    }

    /**
     * @dev Returns an array with all the tokens and balances in a General Pool.
     * This order may change when tokens are added to or removed from the Pool.
     */
    function _getGeneralPoolTokens(bytes32 poolId)
        internal
        view
        returns (IERC20[] memory tokens, bytes32[] memory balances)
    {
        GeneralPoolTokens storage poolTokens = _generalPoolTokens[poolId];
        tokens = new IERC20[](poolTokens.totalTokens);
        balances = new bytes32[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            GeneralPoolTokenInfo storage tokenInfo = poolTokens.info[i];
            tokens[i] = tokenInfo.token;
            balances[i] = tokenInfo.balance;
        }
    }

    function _getGeneralPoolBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        return _getGeneralPoolTokenInfo(poolId, token).balance;
    }

    function _getGeneralPoolTokenInfo(bytes32 poolId, IERC20 token)
        internal
        view
        returns (GeneralPoolTokenInfo storage)
    {
        GeneralPoolTokens storage poolTokens = _generalPoolTokens[poolId];
        uint256 tokenIndex = _getGeneralPoolBalanceTokenIndex(poolTokens, token);
        return poolTokens.info[tokenIndex];
    }

    function _isGeneralPoolTokenRegistered(bytes32 poolId, IERC20 token) internal view returns (bool) {
        GeneralPoolTokens storage poolTokens = _generalPoolTokens[poolId];
        return poolTokens.indices[token] > 0;
    }

    function _getGeneralPoolBalanceTokenIndex(GeneralPoolTokens storage poolTokens, IERC20 token)
        internal
        view
        returns (uint256)
    {
        uint256 index = poolTokens.indices[token];
        require(index > 0, "TOKEN_NOT_REGISTERED");
        return index - 1;
    }
}
