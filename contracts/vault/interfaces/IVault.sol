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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./IFlashLoanReceiver.sol";
import "./IAuthorizer.sol";
import "../../validators/ISwapValidator.sol";

pragma solidity ^0.7.1;

// Full external interface for the Vault core contract - no external or public methods exist in the contract that don't
// override one of these declarations.
//
// All non-view functions in the Vault are non-reentrant: calling them while another one is mid-execution (e.g. while
// execution control is transferred to a token contract during a transfer) will result in a revert. View functions can
// be called, but they might return inconsistent results if called in a reentrant manner.
interface IVault {
    // User Balance

    /**
     * @dev Returns `user`'s User Balance for a specific token.
     */
    function getUserTokenBalance(address user, IERC20 token) external view returns (uint256);

    /**
     * @dev Deposits tokens from the caller into `user`'s User Balance.
     */
    function deposit(
        IERC20 token,
        uint256 amount,
        address user
    ) external;

    /**
     * @dev Withdraws tokens from the caller's User Balance, transferring them to `recipient`. Withdraw protocol fees
     * are charged by this.
     */
    function withdraw(
        IERC20 token,
        uint256 amount,
        address recipient
    ) external;

    // Agents

    /**
     * @dev Authorizes `agent` to act as an agent for the caller.
     */
    function addUserAgent(address agent) external;

    /**
     * @dev Revokes `agent` so that it no longer is an agent for the caller. An account is always its own agent
     * and cannot revoke itself. Universal Agents also cannot be revoked.
     */
    function removeUserAgent(address agent) external;

    /**
     * @dev Returns true of `agent` is an agent for `user`.
     */
    function isAgentFor(address user, address agent) external view returns (bool);

    /**
     * @dev Returns the number of agents for `user`. This does not include `user` itself, nor Universal Agents.
     */
    function getNumberOfUserAgents(address user) external view returns (uint256);

    /**
     * @dev Returns a partial list of `user`'s agents, starting at index `start`, up to index `end`. This does not
     * include `user` itself, nor Universal Agents.
     *
     * The ordering of this list may change as agents are authorized and revoked.
     */
    function getUserAgents(
        address user,
        uint256 start,
        uint256 end
    ) external view returns (address[] memory);

    // Universal Agents

    /**
     @dev Returns the number of Universal Agents.
     */
    function getNumberOfUniversalAgents() external view returns (uint256);

    /**
     * @dev Returns a partial list of Universal Agents, starting at index `start`, up to index `end`.
     */
    function getUniversalAgents(uint256 start, uint256 end) external view returns (address[] memory);

    /**
     * @dev Adds `agent` as a Universal Agent. Can only be called by a Universal Agent Manager.
     */
    function addUniversalAgent(address agent) external;

    /**
     * @dev Removes `agent` as a Universal Agent. Can only be called by a Universal Agent Manager.
     */
    function removeUniversalAgent(address agent) external;

    // Pools

    // There are three optimization levels for Pools, which allow for lower swap gas costs at the cost of reduced
    // functionality:
    //
    //  - standard: no special optimization, IPoolQuote is used to ask for quotes, passing the balance of all tokens in
    // the Pool. Swaps cost more gas the more tokens the Pool has (because of the extra storage reads).
    //
    //  - simplified quote: IPoolQuoteSimplified is used instead, which saves gas by only passes the balance of the two
    // tokens involved in the swap. This is suitable for some pricing algorithms, like the weighted constant product one
    // popularized by Balancer v1. Swap gas cost is independent of the number of tokens in the Pool.
    //
    //  - two tokens: this level achieves the lowest possible swap gas costs by restricting Pools to only having two
    // tokens, which allows for a specialized balance packing format. Like simplified quote Pools, these are called via
    // IPoolQuoteSimplified.
    enum PoolOptimization { STANDARD, SIMPLIFIED_QUOTE, TWO_TOKEN }

    /**
     * @dev Registers a the caller as a Pool, with selected optimization level.
     *
     * Returns the Pool's ID. Also emits a PoolCreated event.
     */
    function registerPool(PoolOptimization optimization) external returns (bytes32);

    /**
     * @dev Emitted when a Pool is created by calling `registerPool`. Contains the Pool ID of the created pool.
     */
    event PoolCreated(bytes32 poolId);

    // Pool Queries

    /**
     * @dev Returns the number of Pools.
     */
    function getNumberOfPools() external view returns (uint256);

    /**
     * @dev Returns a partial list of Pool IDs, starting at index `start`, up to index `end`.
     */
    function getPoolIds(uint256 start, uint256 end) external view returns (bytes32[] memory);

    /**
     * @dev Returns a Pool's address and optimization level.
     */
    function getPool(bytes32 poolId) external view returns (address, PoolOptimization);

    /**
     * @dev Returns all tokens in the Pool (tokens for which the Pool has balance).
     */
    function getPoolTokens(bytes32 poolId) external view returns (IERC20[] memory);

    /**
     * @dev Returns the Pool's balance of `tokens`. This might be zero if the tokens are not in the Pool.
     */
    function getPoolTokenBalances(bytes32 poolId, IERC20[] calldata tokens) external view returns (uint256[] memory);

    // Pool Management

    /**
     * @dev TODO
     */
    function registerTokens(bytes32 poolId, IERC20[] calldata tokens) external;

    event TokensRegistered(bytes32 poolId, IERC20[] tokens);

    /**
     * @dev TODO
     */
    function unregisterTokens(bytes32 poolId, IERC20[] calldata tokens) external;

    event TokensUnregistered(bytes32 poolId, IERC20[] tokens);

    /**
     * @dev Adds liquidity into a Pool. Can only be called by its controller.
     *
     * For each token, the Pool's balance will be increased by `totalAmounts[i]`. This is achieved by first transferring
     * `amountsToTransfer[i]` tokens, and then withdrawing any amount remaining from User Balance. In both cases, the
     * tokens will come from `from`. `from` must have granted allowance to the Vault, and the caller (Pool controller)
     * must be an agent for `from`.
     *
     * If a token that was not previously in the Pool is granted balance by this function, it will become part of the
     * Pool. This is the only way tokens can be added to a Pool.
     */
    function addLiquidity(
        bytes32 poolId,
        address from,
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        bool withdrawFromUserBalance
    ) external;

    /**
     * @dev Removes liquidity from a Pool. Can only be called by its controller.
     *
     * For each token, the Pool's balance will be decreased by `totalAmounts[i]`. This is achieved by first transferring
     * `amountsToTransfer[i]` tokens, and then depositing any amount remaining into User Balance. In both cases, the
     * tokens are sent to `to`. Withdraw protocol fees are charged over any tokens transferred out.
     *
     * If a token that was previously in the Pool has all of its balance removed by this function, it will no longer be
     * in the Pool. This is the only way tokens can be removed from a Pool.
     */
    function removeLiquidity(
        bytes32 poolId,
        address to,
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        bool depositToUserBalance
    ) external;

    // Trading interface

    // Despite the external API having two separate functions for given in and given out, internally their are handled
    // together to avoid unnecessary code duplication. This enum indicates which kind of swap we're processing.
    enum SwapKind { GIVEN_IN, GIVEN_OUT }

    /**
     * @dev Performs a series of swaps with one or multiple Pools. Each swap is validated and executed in order.
     * However, tokens are only transferred in and out of the Vault (or withdrawn/deposited from User Balance) after all
     * swaps have been validated and the net token balance change computed. This means it is possible to e.g. under
     * certain conditions perform arbitrage by swapping with multiple Pools in a way that results in net token movement
     * out of the Vault (profit), with no tokens being sent in.
     *
     * The `diffs` array contains the addresses of all tokens involved in the swaps, along with how many tokens the
     * caller expects to transfer into the Vault for each. Any tokens due to the Vault not included in this amount will
     * be withdrawn from User Balance.
     *
     * The `swaps` array contains the information about each individual swaps. All swaps consist of a Pool receiving
     * some amount of one of its tokens (`tokenIn`), and sending some amount of another one of its tokens (`tokenOut`).
     * A swap can cause `tokenOut` to be fully drained. The Pools' optimization settings will validate each swap,
     * possibly charging a swap fee on the amount going in. If so, the protocol will then charge the protocol swap fee
     * to the Pool's own swap fee.
     *
     * Funds will be received according to the data in `fundsIn`, and sent according to `fundsOut`.
     */
    function batchSwapGivenIn(
        ISwapValidator validator,
        bytes calldata validatorData,
        SwapIn[] calldata swaps,
        IERC20[] memory tokens,
        FundManagement calldata funds
    ) external;

    function batchSwapGivenOut(
        ISwapValidator validator,
        bytes calldata validatorData,
        SwapOut[] calldata swaps,
        IERC20[] memory tokens,
        FundManagement calldata funds
    ) external;

    // batchSwap helper data structures

    // A batched swap is made up of a number of Swaps. Each swap indicates a token balance increasing (tokenIn) and one
    // decreasing (tokenOut) in a pool.
    // Indexes instead of token addresses to not perform lookup in the tokens array.
    struct SwapIn {
        bytes32 poolId;
        uint256 tokenInIndex;
        uint256 tokenOutIndex;
        uint256 amountIn;
        bytes userData;
    }

    struct SwapOut {
        bytes32 poolId;
        uint256 tokenInIndex;
        uint256 tokenOutIndex;
        uint256 amountOut;
        bytes userData;
    }

    // Funds in are received by `IERC20.transferFrom` from `withdrawFrom`. If received funds are not enough, they are
    // withdrawn from withdrawFrom's User Balance.
    // In any case, the caller must be an agent for withdrawFrom.
    // Funds out are deposited to recipient's User Balance, or transferred out if transferToRecipient is true.
    struct FundManagement {
        address sender;
        address recipient;
        bool withdrawFromUserBalance;
        bool depositToUserBalance;
    }

    // Swap query methods

    /**
     * @dev Simulates a call to batchSwapGivenIn, returning an array of Vault token deltas. Each element in the array
     * corresponds to the token at the same index, and indicates the number of tokens the Vault would take from the
     * sender (if positive) or send to the recipient (if negative). The arguments it receives are the same that
     * an equivalent batchSwapGivenIn would receive.
     *
     * Unlike batchSwapGivenIn, this function performs no checks on its caller nor the sender and recipient fields in
     * the FundsManagement struct. This makes it suitable to be called by off-chain applications via eth_call without
     * needing to hold tokens, approve them for the Vault, or even know a user's address.
     *
     * Note however that this function is not 'view' (due to implementation details): the client code must explicitly
     * execute eth_call instead of eth_sendTransaction.
     */
    function queryBatchSwapGivenIn(
        SwapIn[] memory swaps,
        IERC20[] calldata tokens,
        FundManagement calldata funds
    ) external returns (int256[] memory);

    /**
     * @dev Simulates a call to batchSwapGivenOut, returning an array of Vault token deltas. Each element in the array
     * corresponds to the token at the same index, and indicates the number of tokens the Vault would take from the
     * sender (if positive) or send to the recipient (if negative). The arguments it receives are the same that
     * an equivalent batchSwapGivenOut would receive.
     *
     * Unlike batchSwapGivenIn, this function performs no checks on its caller nor the sender and recipient fields in
     * the FundsManagement struct. This makes it suitable to be called by off-chain applications via eth_call without
     * needing to hold tokens, approve them for the Vault, or even know a user's address.
     *
     * Note however that this function is not 'view' (due to implementation details): the client code must explicitly
     * execute eth_call instead of eth_sendTransaction.
     */
    function queryBatchSwapGivenOut(
        SwapOut[] memory swaps,
        IERC20[] calldata tokens,
        FundManagement calldata funds
    ) external returns (int256[] memory);

    // Pay Swap Protocol Fee interface
    /**
     * @dev Receives an array of tokens and their corresponding amounts to which swap protocol fees will be applied.
     * If amounts are greater than zero, it uses them to calculate the corresponding swap protocol fee for the token
     * which is collected by substracting it from the token pool balance.
     */
    function paySwapProtocolFees(
        bytes32 poolId,
        IERC20[] calldata tokens,
        uint256[] calldata collectedFees
    ) external returns (uint256[] memory balances);

    // Flash Loan interface

    /**
     * @dev Performs a flash loan where 'amount' tokens of 'token' are sent to 'receiver', which must implement the
     * IFlashLoanReceiver interface. An arbitrary user-provided 'receiverData' is forwarded to this contract.
     *
     * Before returning from the IFlashLoanReceiver.receiveFlashLoan call, the receiver must transfer back the loaned
     * tokens, plus a proportional protocol fee.
     */
    function flashLoan(
        IFlashLoanReceiver receiver,
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata receiverData
    ) external;

    // Investment interface

    /**
     * @dev Set the investment manager for a pool token
     */
    function setPoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address manager
    ) external;

    /**
     * @dev Returns the investment manager for a token in a pool
     */
    function getPoolInvestmentManager(bytes32 poolId, IERC20 token) external view returns (address);

    /**
     * @dev Increase the invested amount of a given pool token
     */
    function investPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external;

    /**
     * @dev Decrease the invested amount of a given pool token
     */
    function divestPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external;

    /**
     * @dev Update invested amount of a given pool token
     */
    function updateInvested(
        bytes32 poolId,
        IERC20 token,
        uint256 amountInvested
    ) external;

    // Authorizer

    function getAuthorizer() external view returns (IAuthorizer);

    function changeAuthorizer(IAuthorizer newAuthorizer) external;

    // Protocol Fees

    function getProtocolWithdrawFee() external view returns (uint128);

    function getProtocolSwapFee() external view returns (uint128);

    function getProtocolFlashLoanFee() external view returns (uint256);

    function setProtocolWithdrawFee(uint128 newFee) external;

    function setProtocolSwapFee(uint128 newFee) external;

    function setProtocolFlashLoanFee(uint128 newFee) external;

    /**
     * @dev Returns the amount in protocol fees collected for a specific `token`.
     */
    function getCollectedFeesByToken(IERC20 token) external view returns (uint256);

    function withdrawProtocolFees(
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        address recipient
    ) external;
}
