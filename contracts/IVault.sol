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
    enum StrategyType { PAIR, TUPLE }

    function newPool(
        bytes32,
        address,
        StrategyType
    ) external returns (bytes32);

    // Pool config queries

    // Trading with a pool requires either trusting the controller, or going through
    // a proxy that enforces expected conditions (such as pool make up and fees)
    function getController(bytes32 poolId) external view returns (address);

    function getStrategy(bytes32 poolId)
        external
        view
        returns (address, StrategyType);

    function getNumPoolTokens(bytes32 poolId) external view returns (uint256); // do we need this?

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

    // Pool configuration - only callable by the controller

    function setController(bytes32 poolId, address controller) external;

    // TODO rework bind functions to minimize trust of controllers
    // Adds a new token to a pool, with initial balance
    function bind(
        bytes32 poolId,
        address token,
        uint256 balance
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

    // Updates a token's config in a pool with new balance
    // balance (depositing or withdrawing depending on current state)
    function rebind(
        bytes32 poolId,
        address token,
        uint256 balance
    ) external;

    // Trading interface

    function batchSwap(
        Diff[] calldata diffs,
        Swap[] calldata swaps,
        FundsIn calldata fundsIn,
        FundsOut calldata fundsOut
    ) external;

    // batchSwap helper data structures

    // Funds in are received by calling ISwapCaller.sendTokens with receiveCallbackData on the caller. If received funds
    // are not enough, they are withdrawn from withdrawFrom's user balance (the caller must be an operator for this to
    // succeed).
    struct FundsIn {
        address withdrawFrom;
        bytes callbackData;
    }

    // Funds out are assigned to recipient's user balance, or transferred out if transferToRecipient is true.
    struct FundsOut {
        address recipient;
        bool transferToRecipient;
    }

    // An array of Diffs with unique token addresses will store the net effect of a trade
    // on the entire Vault. Callers provide this array pre-populated with the address of
    // each token involved in the swap, and an initial vaultDelta value of 0.
    // This saves the contract from having to compute the list of tokens that need to be
    // sent or received as part of the trade.
    struct Diff {
        address token;
        int256 vaultDelta; // Positive delta means the vault receives tokens
    }

    // A batched swap is made up of a number of Swaps. Each swap indicates a token balance increasing (tokenIn) and one
    // decreasing (tokenOut) in a pool.
    struct Swap {
        bytes32 poolId;
        TokenData tokenIn;
        TokenData tokenOut;
    }

    // 'amount' can mean tokens going either into or out of the Vault, depending on context.
    // If TokenData also included the token address, then the swap function would need to look up the index of this
    // token in the Diffs array. Instead, the caller provides the indices for the Diffs array, leading to gas savings.
    struct TokenData {
        uint128 amount;
        uint128 tokenDiffIndex;
    }
}
