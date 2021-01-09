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
import "./ISwapValidator.sol";

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
     * @dev Deposits tokens from the caller into `user`'s User Balance. The caller must have allowed the Vault to use
     * their tokens via `IERC20.approve()`.
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
     * @dev Returns true if `agent` is an agent for `user`. An account's agent can make the Vault use the managed
     * account's approved tokens. All accounts are agents for themselves.
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
     * The ordering of this list may change as agents are added and removed.
     */
    function getUserAgents(
        address user,
        uint256 start,
        uint256 end
    ) external view returns (address[] memory);

    /**
     * @dev Adds `agent` as an agent for the caller.
     */
    function addUserAgent(address agent) external;

    /**
     * @dev Removes `agent` as an agent for the caller. An account is always its own agent: removing itself does
     * nothing. Universal Agents cannot be removed either.
     */
    function removeUserAgent(address agent) external;

    // Universal Agents

    /**
     @dev Returns the number of Universal Agents.
     */
    function getNumberOfUniversalAgents() external view returns (uint256);

    /**
     * @dev Returns a partial list of Universal Agents, starting at index `start`, up to index `end`. * The ordering of
     * this list may change as Universal Agents are added and removed.
     *
     * Universal Agents are agents for all accounts.
     */
    function getUniversalAgents(uint256 start, uint256 end) external view returns (address[] memory);

    /**
     * @dev Adds `agent` as a Universal Agent.
     *
     * Requirements:
     *
     * - the caller must be approved by the authorizer (`IAuthorizer.canAddUniversalAgent`).
     */
    function addUniversalAgent(address agent) external;

    /**
     * @dev Removes `agent` as a Universal Agent.
     *
     * Requirements:
     *
     * - the caller must be approved by the authorizer (`IAuthorizer.canRemoveUniversalAgent`).
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
     * @dev Emitted when a Pool is created by calling `registerPool`. Contains the Pool ID of the registered pool.
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

    // These functions revert if querying a Pool that doesn't exist

    /**
     * @dev Returns a Pool's address and optimization level.
     */
    function getPool(bytes32 poolId) external view returns (address, PoolOptimization);

    /**
     * @dev Returns all tokens registered by a Pool. The order of this list might change as tokens are registered and
     * unregistered.
     */
    function getPoolTokens(bytes32 poolId) external view returns (IERC20[] memory);

    /**
     * @dev Returns the Pool's balance of `tokens`. This is the total balance, including assets held by the Pool's
     * Investment Manager and not currently held by the Vault.
     *
     * Each token in `tokens` must have been registered by the Pool.
     */
    function getPoolTokenBalances(bytes32 poolId, IERC20[] calldata tokens) external view returns (uint256[] memory);

    // Pool Management

    /**
     * @dev Called by the Pool to register `tokens`. A Pool can only add and remove liquidity for tokens it has
     * registered, and all swaps with a Pool must involve registered tokens.
     *
     * Each token in `tokens` must not be already registered before this call. For Pools with the Two Token
     * optimization, `tokens` must have a length of two, that is, both tokens must be registered at the same time.
     */
    function registerTokens(bytes32 poolId, IERC20[] calldata tokens) external;

    event TokensRegistered(bytes32 poolId, IERC20[] tokens);

    /**
     * @dev Called by the Pool to unregisted `tokens`. This prevents adding and removing liquidity in the future, as
     * well as swaps. Unregistered tokens can be re-registered in the future.
     *
     *
     * Each token in `tokens` must be registered before this call, and have zero balance. For Pools with the Two Token
     * optimization, `tokens` must have a length of two, that is, both tokens must be unregistered at the same time.
     */
    function unregisterTokens(bytes32 poolId, IERC20[] calldata tokens) external;

    event TokensUnregistered(bytes32 poolId, IERC20[] tokens);

    /**
     * @dev Called by the Pool to add tokens to its balance. Only registered tokens can have liquidity added.
     *
     * The tokens will be withdrawn from the `from` account, which the Pool must be an agent for. If
     * `withdrawFromUserBalance` is true, `from`'s User Balance will be preferred, performing an ERC20 transfer for the
     * difference between the requested amount and User Balance (if any). `from` must have allowed the Vault to use
     * their tokens via `IERC20.approve()`.
     */
    function addLiquidity(
        bytes32 poolId,
        address from,
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        bool withdrawFromUserBalance
    ) external;

    /**
     * @dev Called by the Pool to remove tokens from its balance. Only registered tokens can have liquidity removed.
     *
     * The tokens will be sent to the `to` account. If `depositToUserBalance` is true, they will be added as User
     * Balance instead of transferred.
     */
    function removeLiquidity(
        bytes32 poolId,
        address to,
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        bool depositToUserBalance
    ) external;

    // Swap interface

    /**
     * @dev Performs a series of swaps with one or multiple Pools. In each swap, the amount of tokens sent to the Pool
     * is known. For swaps where the amount of tokens received from the Pool is known, see `batchSwapGivenOut`.
     *
     * Returns an array with the net Vault token balance deltas. Positive amounts represent tokens sent to the Vault,
     * and negative amounts tokens sent by the Vault. Each delta corresponds to the token at the same index in the
     * `tokens` array.
     *
     * A `validator` can be optionally supplied, and if so it will be called with `tokens`, the Vault deltas, and
     * user-supplied `validatorData`. This is useful to check a swap has happened according to user expectations (and
     * wasn't, for example, affected by other transactions), and potentially revert if not.
     *
     * Each swap is executed independently in the order specified by the `swaps` array. However, tokens are only
     * transferred in and out of the Vault (or withdrawn from and deposited into User Balance) after all swaps have been
     * completed and the net token balance change computed. This means it is possible to e.g. under certain conditions
     * perform arbitrage by swapping with multiple Pools in a way that results in net token movement out of the Vault
     * (profit), with no tokens being sent in (but updating the Pool's internal balances).
     *
     * The `swaps` array contains the information about each individual swaps. All swaps consist of a Pool receiving
     * some amount of one of its tokens (`tokenIn`), and sending some amount of another one of its tokens (`tokenOut`).
     * The `tokenOut` amount is determined by the Pool's pricing algorithm by calling the `quoteOutGivenIn` function (from
     * IPoolQuote or IPoolQuoteSimplified).
     *
     * Multihop swaps, where one token is exchanged for another one by passing through one or more intermediate tokens,
     * can be executed by passing an `amountIn` value of zero for a swap. This will cause the amount out of the previous
     * swap to be used as the amount in of the current one. In such a scenario, `tokenIn` must equal the previous swap's
     * `tokenOut`.
     *
     * The `tokens` array contains the addresses of all tokens involved in the swaps.
     *
     * Funds will be sent and  received according to the data in the `funds` struct.
     */
    function batchSwapGivenIn(
        ISwapValidator validator,
        bytes calldata validatorData,
        SwapIn[] calldata swaps,
        IERC20[] memory tokens,
        FundManagement calldata funds
    ) external returns (int256[] memory);

    /**
     * @dev Data for a swap executed via `batchSwapGivenIn`. The tokens in and out are indexed in the `tokens` array
     * passed to that function.
     *
     * `amountIn` tokens are sent to the `poolId` Pool for the token in, and `userData` is forwarded to the Pool in the
     * `quoteOutGivenIn` function. If `amountIn` is zero, the multihop mechanism is used to determine the actual amount.
     */
    struct SwapIn {
        bytes32 poolId;
        uint256 tokenInIndex;
        uint256 tokenOutIndex;
        uint256 amountIn;
        bytes userData;
    }

    /**
     * @dev Performs a series of swaps with one or multiple Pools. In each swap, the amount of tokens received from the
     * Pool is known. For swaps where the amount of tokens sent to the Pool is known, see `batchSwapGivenIn`.
     *
     * Returns an array with the net Vault token balance deltas. Positive amounts represent tokens sent to the Vault,
     * and negative amounts tokens sent by the Vault. Each delta corresponds to the token at the same index in the
     * `tokens` array.
     *
     * A `validator` can be optionally supplied, and if so it will be called with `tokens`, the Vault deltas, and
     * user-supplied `validatorData`. This is useful to check a swap has happened according to user expectations (and
     * wasn't, for example, affected by other transactions), and potentially revert if not.
     *
     * Each swap is executed independently in the order specified by the `swaps` array. However, tokens are only
     * transferred in and out of the Vault (or withdrawn from and deposited into User Balance) after all swaps have been
     * completed and the net token balance change computed. This means it is possible to e.g. under certain conditions
     * perform arbitrage by swapping with multiple Pools in a way that results in net token movement out of the Vault
     * (profit), with no tokens being sent in (but updating the Pool's internal balances).
     *
     * The `swaps` array contains the information about each individual swaps. All swaps consist of a Pool receiving
     * some amount of one of its tokens (`tokenIn`), and sending some amount of another one of its tokens (`tokenOut`).
     * The `tokenIn` amount is determined by the Pool's pricing algorithm by calling the `quoteInGivenOut` function
     * (from IPoolQuote or IPoolQuoteSimplified).
     *
     * Multihop swaps, where one token is exchanged for another one by passing through one or more intermediate tokens,
     * can be executed by passing an `amountOut` value of zero for a swap. This will cause the amount in of the previous
     * swap to be used as the amount out of the current one. In such a scenario, `tokenOut` must equal the previous
     * swap's `tokenIn`.
     *
     * The `tokens` array contains the addresses of all tokens involved in the swaps.
     *
     * Funds will be sent and  received according to the data in the `funds` struct.
     */
    function batchSwapGivenOut(
        ISwapValidator validator,
        bytes calldata validatorData,
        SwapOut[] calldata swaps,
        IERC20[] memory tokens,
        FundManagement calldata funds
    ) external returns (int256[] memory);

    /**
     * @dev Data for a swap executed via `batchSwapGivenOut`. The tokens in and out are indexed in the `tokens` array
     * passed to that function.
     *
     * `amountOut` tokens are received from the `poolId` Pool for the token out, and `userData` is forwarded to the Pool
     *  in the `quoteInGivenOut` function. If `amountOut` is zero, the multihop mechanism is used to determine the
     * actual amount.
     */
    struct SwapOut {
        bytes32 poolId;
        uint256 tokenInIndex;
        uint256 tokenOutIndex;
        uint256 amountOut;
        bytes userData;
    }

    /**
     * @dev All tokens in a swap are sent to the Vault from the `sender`'s account, and sent to the `recipient`. The
     * caller of the swap function must be an agent for `sender`.
     *
     * If `withdrawFromUserBalance` is true, `sender`'s User Balance will be preferred, performing an ERC20 transfer for
     * the difference between the requested amount and User Balance (if any). `sender` must have allowed the Vault to
     * use their tokens via `IERC20.approve()`. This matches the behavior of `addLiquidity`.
     *
     * If `depositToUserBalance` is true, tokens will be deposited to `recipient`'s user balance instead of transferred.
     * This matches the behavior of `removeLiquidity`.
     */
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
