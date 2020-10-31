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

    function newPool(address, StrategyType) external returns (bytes32);

    function getTotalPools() external view returns (uint256);

    function getPoolIds(uint256 startIndex, uint256 endIndex)
        external
        view
        returns (bytes32[] memory);

    // Pool config queries

    // Trading with a pool requires either trusting the controller, or going through
    // a proxy that enforces expected conditions (such as pool make up and fees)
    function getPoolController(bytes32 poolId) external view returns (address);

    function getPoolStrategy(bytes32 poolId)
        external
        view
        returns (address, StrategyType);

    function getPoolTokens(bytes32 poolId)
        external
        view
        returns (address[] memory);

    function getPoolTokenBalances(bytes32 poolId, address[] calldata tokens)
        external
        view
        returns (uint128[] memory);

    // Pool configuration - only callable by the controller

    function setPoolController(bytes32 poolId, address controller) external;

    function depositToPool(
        bytes32 poolId,
        address from,
        address[] calldata tokens,
        uint128[] calldata amounts
    ) external;

    function withdrawFromPool(
        bytes32 poolId,
        address to,
        address[] calldata tokens,
        uint128[] calldata amounts
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
        uint256 amountIn;
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
