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

pragma experimental ABIEncoderV2;

pragma solidity ^0.7.1;

interface IVault {
    function newPool(bytes32) external returns (bytes32);

    // Pool config queries

    // Trading with a pool requires either trusting the controller, or going through
    // a proxy that enforces expected conditions (such as pool make up and fees)
    function getController(bytes32 poolId) external view returns (address);

    // Can the pool be traded against
    function isPaused(bytes32 poolId) external view returns (bool);

    function getSwapFee(bytes32 poolId) external view returns (uint256);

    function getNumPoolTokens(bytes32 poolId) external view returns (uint256); // do we need this?

    //function getTokens(bytes32 poolId) external view returns (address[] memory tokens);
    function getTokenAmountsIn(
        bytes32 poolId,
        uint256 ratio,
        uint256[] calldata maxAmountsIn
    ) external view returns (uint256[] memory);

    function getTokenAmountsOut(
        bytes32 poolId,
        uint256 ratio,
        uint256[] calldata minAmountsOut
    ) external view returns (uint256[] memory);

    function getPoolTokenBalances(bytes32 poolId, address[] calldata tokens)
        external
        view
        returns (uint256[] memory);

    function getPoolTokens(bytes32 poolId)
        external
        view
        returns (address[] memory);

    function isTokenBound(bytes32 poolId, address token)
        external
        view
        returns (bool);

    function getTokenNormalizedWeight(bytes32 poolId, address token)
        external
        view
        returns (uint256);

    // do we need these two?
    function getTokenDenormalizedWeight(bytes32 poolId, address token)
        external
        view
        returns (uint256);

    function getTotalDenormalizedWeight(bytes32 poolId)
        external
        view
        returns (uint256);

    // TBD if we expose these as-is, or provide lower-level primitives (possibly accounting for multiple curves)
    function getSpotPrice(
        bytes32 poolId,
        address tokenIn,
        address tokenOut
    ) external view returns (uint256 spotPrice);

    function getSpotPriceSansFee(
        bytes32 poolId,
        address tokenIn,
        address tokenOut
    ) external view returns (uint256 spotPrice);

    // Pool configuration - only callable by the controller

    function setController(bytes32 poolId, address controller) external;

    function setPaused(bytes32 poolId, bool paused) external;

    function setSwapFee(bytes32 poolId, uint256 swapFee) external;

    // TODO rework bind functions to minimize trust of controllers
    // Adds a new token to a pool, with initial balance and (denorm) weight
    function bind(
        bytes32 poolId,
        address token,
        uint256 balance,
        uint256 denorm
    ) external;

    // Removes a token from a pool, withdrawing all balance
    function unbind(bytes32 poolId, address token) external;

    // functions for adding several tokens minting/burning bpt
    function addInitialLiquidity(
        bytes32 poolId,
        address[] calldata initialTokens,
        uint256[] calldata amountsIn
    ) external;

    function addLiquidity(bytes32 poolId, uint256[] calldata amountsIn)
        external;

    function removeLiquidity(
        bytes32 poolId,
        address recipient,
        uint256[] calldata amountsOut
    ) external;

    // Updates a token's config in a pool, with new (denorm) weight and
    // balance (depositing or withdrawing depending on current state)
    function rebind(
        bytes32 poolId,
        address token,
        uint256 balance,
        uint256 denorm
    ) external;

    // Trading interface

    function batchSwap(
        Diff[] calldata diffs,
        Swap[] calldata swaps,
        address recipient,
        bytes calldata callbackData
    ) external;

    // batchSwap helper data structures

    // An array of Diffs with unique token addresses will store the net effect of a trade
    // on the entire Vault. Callers provide this array pre-populated with the address of
    // each token involved in the swap, and an initial vaultDelta value of 0.
    // This saves the contract from having to compute the list of tokens that need to be
    // sent or received as part of the trade.
    struct Diff {
        address token;
        int256 vaultDelta; // Positive delta means the vault receives tokens
    }

    // A batched swap is made up of a number of Swaps. Each swap indicates a change in the
    // balances of a token pair in a pool.
    struct Swap {
        bytes32 poolId;
        TokenData tokenA;
        TokenData tokenB;
    }

    // For each token involved in a Swap, TokenData indicates by how much the balance for
    // that token in the associated pool should change. If TokenData also included the token
    // address, then the swap function would need to look up the index of this token in the
    // Diffs array. Instead, the caller provides the indices for the Diffs array, leading to
    // gas savings.
    struct TokenData {
        int256 delta;
        uint256 tokenDiffIndex;
    }
}
