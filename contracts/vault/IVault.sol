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

// Needed for struct arguments
pragma experimental ABIEncoderV2;

// Imports

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IFlashLoanReceiver.sol";
import "../validators/ISwapValidator.sol";

// Interfaces

/**
 * @title Interface for the Vault - the core contracts of Balancer v2 that hold and manage all assets on the protocol,
 *        as well as implementing swaps and accommodating flash loans
 * @author Balancer Labs
 * @dev Full external interface for the Vault contracts - all external or public methods in the core system
 *      must override one of these declarations
 */
interface IVault {
    // Type declarations

    // There are two variants of Trading Strategies for Pools: Pair Trading Strategies, and Tuple Trading Strategies.
    // These require different data from the Vault, which is reflected in their differing interfaces
    // (IPairTradingStrategy and ITupleTradingStrategy, respectively)
    enum StrategyType { PAIR, TUPLE }

    // Despite the external API having two separate functions for given in and given out, internally they are handled
    // together to avoid unnecessary code duplication. This enum indicates which kind of swap we're processing
    // GIVEN_IN means: I want to sell you X amount of token A to get token B
    // GIVEN_OUT means: I want to sell you token A to get X amount of token B
    // So the "given" amount is the "known" quantity (that you have, or that you want)
    enum SwapKind { GIVEN_IN, GIVEN_OUT }

    // BatchSwap helper data structures

    // A batched swap is made up of a number of individual swaps. Each swap with a pool involves
    // increasing the balance of one token (tokenIn), and decreasing the balance of another (tokenOut).
    struct SwapIn {
        bytes32 poolId;
        uint128 tokenInIndex;
        uint128 tokenOutIndex;
        uint128 amountIn;
        bytes userData;
    }

    struct SwapOut {
        bytes32 poolId;
        uint128 tokenInIndex;
        uint128 tokenOutIndex;
        uint128 amountOut;
        bytes userData;
    }

    // Incoming funds are transfered from the sender address using `IERC20.transferFrom`.
    // If withdrawFromUserBalance is true, assets are deducted from sender's user balance
    // instead of being transferred. If this internal balance is not enough, then it will
    // pull them from sender's wallet.
    // In any case, the caller must be an agent for sender.
    // Outgoing funds are deposited to the recipient's User Balance, or if transferToRecipient is true,
    //   transferred to recipient's wallet.
    struct FundManagement {
        address sender;
        address recipient;
        bool withdrawFromUserBalance;
        bool depositToUserBalance;
    }

    // Event declarations

    /**
     * @notice Emitted when a Pool is created by calling `newPool`. Contains the Pool ID of the created pool
     * @dev poolIds are neither contract addresses nor pure numeric ids; they are encoded in `PoolRegistry`
     *      through the `fromPoolId` and `toPoolId` functions.
     *      Emitted by `PoolRegistry`
     */
    event PoolCreated(bytes32 poolId);

    // Function declarations

    /**
     * @notice Returns user's User Balance for a specific token.
     * @dev User balances are effectively a "wallet" inside the protocol,
     *      Transactions that use User Balance can skip the ERC20 transfers and therefore use less gas,
     *      for example when swapping or adding liquidity to a Pool.
     *      Among other uses, UserBalance can be funded by calling `deposit` and retrieved by calling `withdraw`.
     *      Implemented by `UserBalance`
     * @param user - account with the balance; not necessarily the caller
     * @param token - the token whose balance we want
     * @return user's balance
     */
    function getUserTokenBalance(address user, IERC20 token) external view returns (uint128);

    /**
     * @notice Deposits tokens from the caller into user's User Balance.
     * @dev User balances are effectively a "wallet" inside the protocol,
     *      that can be used to fund or receive proceeds from swaps or other operations.
     *      Since the user need not be the caller, this enables authorized third party transfers
     *      Implemented by `UserBalance`
     * @param token - the token to deposit
     * @param amount - amount of the deposit
     * @param user - account to receive the deposit; not necessarily the caller
     */
    function deposit(
        IERC20 token,
        uint128 amount,
        address user
    ) external;

    /**
     * @notice Withdraws tokens from the caller's User Balance, transferring them to recipient.
     *         Charges withdrawal protocol fees
     * @dev User balances are effectively a "wallet" inside the protocol,
     *      that can be used to fund or receive proceeds from swaps or other operations.
     *      Since the user need not be the caller, this enables authorized third party transfers
     *      (for instance, a GUI proxy can transfer tokens directly to a destination wallet
     *       in a single transfer)
     *      Implemented by `UserBalance`
     * @param token - the token to withdraw
     * @param amount - amount of the withdraw
     * @param recipient - account to receive the withdrawal; not necessarily the caller
     */
    function withdraw(
        IERC20 token,
        uint128 amount,
        address recipient
    ) external;

    // User Agents

    /**
     * @notice Authorizes an address to act as an agent for the caller.
     * @dev Overriden in UserBalance - adds an agent to the caller's account.
     *      An account's agents can use any of their approved tokens to perform swaps or add liquidity.
     *      Therefore, agents should only be smart contracts that perform authorization checks on the addresses
     *      whose funds they manage, such as using msg.sender or validating signed messages.
     *      Implemented by `UserBalance`
     * @param agent - can add liquidity/swap for the caller
     */
    function addUserAgent(address agent) external;

    /**
     * @notice Revokes agent's permission to act on behalf of the caller.
     * @dev An account is always its own agent. and cannot revoke itself.
     *      Implemented by `UserBalance`
     * @param agent - can no longer add liquidity/swap for the caller
     */
    function removeUserAgent(address agent) external;

    /**
     * @notice Returns true if the "agent" address is an agent for user
     * @dev This will return true for three types of accounts:
     *      - agents added via `addUserAgent`
     *      - universal agents, added via `addUniversalAgent` by a Universal Agent Manager
     *      - the account itself (i.e., all accounts are agents for themselves)"
     *      Implemented by `UserBalance`
     * @param user - the user we're checking
     * @param agent - the potential agent for this user
     * @return boolean flag; true if the given "agent" address can act as an agent for the user
     */
    function isAgentFor(address user, address agent) external view returns (bool);

    /**
     * @notice Returns the number of agents for a user
     * @dev This does not include the user account itself, nor Universal Agents
     *      Implemented by `UserBalance`
     * @param user - subject of the query
     */
    function getNumberOfUserAgents(address user) external view returns (uint256);

    /**
     * @notice Returns a partial list of user's agents as a 0-based, exclusive range [start, end)
     * @dev This does not include the user address itself, or universal agents.
     *      The ordering of this list may change as agents are added and removed.
     *      (e.g., 0-3 would get elements 0, 1, and 2).
     *      Implemented by `UserBalance`
     * @param user - subject of the query
     * @param start - 0-based index into the list
     * @param end - ending index (exclusive)
     * @return list of addresses representing a "page" of user agents
     */
    function getUserAgents(
        address user,
        uint256 start,
        uint256 end
    ) external view returns (address[] memory);

    // Universal Agents

    /**
     * @notice Returns the number of Universal Agents
     * @dev    Implemented by `UserBalance`
     * @return total number of universal agents
     */
    function getNumberOfUniversalAgents() external view returns (uint256);

    /**
     * @notice Returns a partial list of Universal Agents as a 0-based, exclusive range [start, end)
     * @dev    Implemented by `UserBalance`
     * @param start - 0-based index into the list
     * @param end - ending index (exclusive)
     * @return list of addresses representing a "page" of universal agents
     */
    function getUniversalAgents(uint256 start, uint256 end) external view returns (address[] memory);

    /**
     * @notice Returns the number of Universal Agent Managers
     * @dev These are privileged accounts that can add/remove universal agents
     *      Implemented by `UserBalance`
     * @return total number of universal agent managers
     */
    function getNumberOfUniversalAgentManagers() external view returns (uint256);

    /**
     * @notice Returns a partial list of Universal Agent Managers as a 0-based, exclusive range [start, end)
     * @dev    Implemented by `UserBalance`
     * @param start - 0-based index into the list
     * @param end - ending index (exclusive)
     * @return list of addresses representing a "page" of universal agent managers
     */
    function getUniversalAgentManagers(uint256 start, uint256 end) external view returns (address[] memory);

    /**
     * @notice Adds an address as a Universal Agent. Can only be called by a Universal Agent Manager
     * @dev Emits an event when successful (e.g., the agent was not already in the list).
     *      Implemented by `UserBalance`
     * @param agent - the new universal agent
     */
    function addUniversalAgent(address agent) external;

    /**
     * @notice Removes agent as a Universal Agent. Can only be called by a Universal Agent Manager
     * @dev Emits an event when successful (e.g., the agent was in the list).
     *      Implemented by `UserBalance`
     * @param agent - the universal agent to be removed
     */
    function removeUniversalAgent(address agent) external;

    /**
     * @notice Creates a new Pool with a Trading Strategy and Trading Strategy Type.
     *         The caller of this function becomes the Pool's controller.
     * @dev Returns the created Pool's ID, and emits a PoolCreated event.
     *      Implemented by `PoolRegistry`
     * @param strategy - the address of the deployed pool contract
     * @param strategyType - the type of the strategy (will be encoded into the poolId)
     * @return the PoolId (managed by `PoolRegistry` functions `fromPoolId` and `toPoolId`)
     */
    function newPool(address strategy, StrategyType strategyType) external returns (bytes32);

    // Pool Queries

    /**
     * @notice Returns the number of Pools
     * @dev    Implemented by `PoolRegistry`
     * @return - total pool count
     */
    function getNumberOfPools() external view returns (uint256);

    /**
     * @notice Returns a partial list of Pool IDs as a 0-based, exclusive range [start, end)
     * @dev    Implemented by `PoolRegistry`
     * @param start - 0-based index into the list
     * @param end - ending index (exclusive)
     */
    function getPoolIds(uint256 start, uint256 end) external view returns (bytes32[] memory);

    /**
     * @notice Returns a Pool's address and strategy type
     * @dev Implemented by `PoolRegistry`
     * @param poolId - the ID of the pool
     * @return address and strategy type of the pool
     */
    function getPool(bytes32 poolId) external view returns (address, StrategyType);

    /**
     * @notice Returns all tokens in the Pool (by definition, those with non-zero balances)
     * @dev    Implemented by `PoolRegistry`
     * @param poolId - the ID of the pool
     * @return list of ERC20 token addresses
     */
    function getPoolTokens(bytes32 poolId) external view returns (IERC20[] memory);

    /**
     * @notice Returns the Pool's balances for a set of tokens. These can be zero if the tokens are not in the Pool
     * @dev    Implemented by `PoolRegistry`
     * @param poolId - the ID of the pool
     * @param tokens - list of ERC20 token addresses to check
     * @return list of numeric balances (in wei)
     */
    function getPoolTokenBalances(bytes32 poolId, IERC20[] calldata tokens) external view returns (uint128[] memory);

    // Pool Management

    /**
     * @dev Adds liquidity into a Pool. Can only be called by its controller.
     *
     * @dev For each token, the Pool's balance will be increased by amounts[i]. This is achieved by first withdrawing
     *      amounts[i] from User Balance (if the flag is set), then transferring any amount remaining from the sender.
     *      In both cases, the tokens will come from the "from" address. "from" must have granted allowance to the
     *      Vault, and the caller (Pool controller) must be an agent for "from".
     *
     *      If a token that was not previously in the Pool is granted balance by this function, it will become part
     *      of the Pool. This is the only way tokens can be added to a Pool.
     *      Implemented by `PoolRegistry`
     * @param poolId - the ID of the pool
     * @param from - the source of the funds (and a reference to the User Balance if needed)
     * @param tokens - the tokens to be added (can be any set of tokens, whether or not they're already in the pool)
     * @param amounts - balances of the tokens in the list
     * @param withdrawFromUserBalance - if set, attempt to withdraw the remainder from User Balance, if the incoming
     *                                  token balances are insufficient to fund the liquidity
     */
    function addLiquidity(
        bytes32 poolId,
        address from,
        IERC20[] calldata tokens,
        uint128[] calldata amounts,
        bool withdrawFromUserBalance
    ) external;

    /**
     * @notice Removes liquidity from a Pool. Can only be called by its controller
     *
     * @dev For each token, the Pool's balance will be decreased by amounts[i]. This is achieved by first transferring
     *      amounts[i] tokens, and then depositing any amount remaining into User Balance (if the flag is set).
     *      In both cases, the tokens are sent to "to". Any tokens transferred outside the vault are subject to the
     *      protocol withdrawal fee.
     *
     *      Using the depositToUserBalance flag, it is possible to remove liquidity from one pool and add it to another,
     *      or fund swaps and other operations, without incurring any protocol withdrawal fees.
     *
     *      If a token that was previously in the Pool has all of its balance removed by this function, it will be
     *      removed from the Pool. This is the only way tokens can be removed from a Pool.
     *      Implemented by `PoolRegistry`
     * @param poolId - the ID of the pool
     * @param to - the destination of the funds (and a reference to the User Balance if needed)
     * @param tokens - the tokens to be withdrawn from the Pool
     * @param amounts - the amount of each token to be withdrawn
     * @param depositToUserBalance - if set, deposit the proceeds to User Balance, rather than transferring them outside
     *                               the vault (and incurring the protocol withdrawal fee)
     */
    function removeLiquidity(
        bytes32 poolId,
        address to,
        IERC20[] calldata tokens,
        uint128[] calldata amounts,
        bool depositToUserBalance
    ) external;

    // Trading interface

    /**
     * @notice Performs a series of swaps with one or multiple Pools. Each swap is validated and executed in order.
     *
     * @dev Tokens are only transferred in and out of the Vault (or withdrawn/deposited from User Balance) after all
     *      swaps have been validated and the net token balance change computed. This means it is possible under
     *      certain conditions to perform arbitrage by swapping with multiple Pools in a way that results in net token
     *      movement out of the Vault (profit), with no tokens being sent in.
     *
     *      The "diffs" array contains the addresses of all tokens involved in the swaps, along with how many tokens of
     *      each the caller expects to transfer into the Vault. Any tokens due to the Vault that are not included
     *      in this amount will be withdrawn from User Balance.
     *
     *      The "swaps" array contains the information about each individual swap. All swaps consist of a Pool receiving
     *      some amount of one of its tokens (tokenIn), and sending some amount of another (tokenOut).
     *      A swap cannot cause the tokenOut balance to go to zero. The Pools will validate each swap,
     *      possibly charging a swap fee on the amount going in. If so, the protocol will add the protocol swap fee
     *      to the Pool's own swap fee. (Since the protocol swap fee is a percentage of the pool's fee, zero-fee
     *      pools will also not incur a protocol swap fee.)
     *
     *      Interactions with User Balances will be driven by the data in the FundManagement structure.
     *      In/Out refers to the direction (SwapKind):
     *      GIVEN_IN means: I want to sell you X amount of token A to get token B
     *      GIVEN_OUT means: I want to sell you token A to get X amount of token B
     *
     *      Implemented by `Swaps`
     * @param validator - interface to a contract that will "validate" the swap (i.e., apply the price curve)
     * @param validatorData - provide any data required by the validator algorithm
     * @param swaps - set of swaps to be performed
     * @param tokens - tokens required to fund the swaps
     * @param funds - addresses and User Balance flags
     */
    function batchSwapGivenIn(
        ISwapValidator validator,
        bytes calldata validatorData,
        SwapIn[] calldata swaps,
        IERC20[] memory tokens,
        FundManagement calldata funds
    ) external;

    /**
     * @notice Performs a series of swaps with one or multiple Pools. Each swap is validated and executed in order
     * @dev Implemented by `Swaps`
     * @param validator - interface to a contract that will "validate" the swap (i.e., apply the price curve)
     * @param validatorData - provide any data required by the validator algorithm
     * @param swaps - set of swaps to be performed
     * @param tokens - tokens required to fund the swaps
     * @param funds - addresses and User Balance flags
     */
    function batchSwapGivenOut(
        ISwapValidator validator,
        bytes calldata validatorData,
        SwapOut[] calldata swaps,
        IERC20[] memory tokens,
        FundManagement calldata funds
    ) external;

    // Pay Swap Protocol Fee interface

    /**
     * @notice Receives an array of tokens and their corresponding amounts to which swap protocol fees will be applied.
     * @dev    If amounts are greater than zero, it uses them to calculate the corresponding swap protocol fee for the
     *         token, which is collected by subtracting it from the token pool balance.
     *         Pool swap fees are computed first (as a percentage of trading volume), then the protocol fees are applied
     *         as a percentage of the swap fees.
     *         Implemented in `Swaps`
     * @param poolId - the Pool ID
     * @param tokens - the tokens to which we're applying fees
     * @param collectedFees - the pool swap fees to be collected
     * @return balances - the pool token balances after all fees are applied
     */
    function paySwapProtocolFees(
        bytes32 poolId,
        IERC20[] calldata tokens,
        uint128[] calldata collectedFees
    ) external returns (uint128[] memory balances);

    // Flash Loan interface

    /**
     * @notice Performs a flash loan where "amount" tokens of "token" are sent to "receiver", which must implement the
     *         IFlashLoanReceiver interface. An arbitrary user-provided "receiverData" is forwarded to this contract.
     *
     * @dev Before returning from the IFlashLoanReceiver.receiveFlashLoan call, the receiver must transfer back the
     *      loan amount, plus a proportional protocol fee.
     *
     *      This is a non-reentrant call: swaps, adding liquidity, etc., are all disabled until the flash loan finishes.
     *      Implemented by contracts that implement `IFlashLoanReceiver`
     * @param receiver - contract implementing the IFlashLoanReceiver interface
     * @param tokens - the tokens being sent to receiver
     * @param amounts - token balances used for the loan
     * @param receiverData - data required by the particular IFlashLoanReceiver to process the loan
     */
    function flashLoan(
        IFlashLoanReceiver receiver,
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata receiverData
    ) external;

    // Investment interface

    /**
     * @notice Authorize an investment manager for a pool token
     * @dev The manager can only access a certain percentage of the pool balance, which can vary by token
     *      Implemented by `PoolRegistry`
     * @param poolId - the ID of the pool
     * @param token - the token asset we are putting under management
     * @param manager - the asset manager now allowed to manage this pool token
     */
    function authorizePoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address manager
    ) external;

    /**
     * @notice Revoke the current investment manager of a pool token
     * @dev    Implemented by `PoolRegistry`
     * @param poolId - the ID of the pool
     * @param token - the token asset we are reclaiming from management
     */
    function revokePoolInvestmentManager(bytes32 poolId, IERC20 token) external;

    /**
     * @notice Increase the managed amount of a given pool token
     * @dev Each token has cash and managed portions, where cash + managed = total
     *      Increasing the managed amount will decrease the cash available
     *      Implemented by `PoolRegistry`
     * @param poolId - the ID of the pool
     * @param token - the token asset under management
     * @param amount - the amount we are adding to the managed balance
     */
    function investPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external;

    /**
     * @notice Decrease the managed amount of a given pool token
     * @dev Each token has cash and managed portions, where cash + managed = total
     *      Decreasing the managed amount will increase the cash available
     *      Implemented by `PoolRegistry`
     * @param poolId - the ID of the pool
     * @param token - the token asset under management
     * @param amount - the amount we are withdrawing from the managed balance
     */
    function divestPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external;

    /**
     * @notice Update the managed amount of a given pool token
     * @dev Each token has cash and managed portions, where cash + managed = total
     *      This function directly sets the managed portion, leaving cash unchanged (so total will change)
     *      Asset managers call this to report profits or losses
     *        (i.e., if the new amount is greater than the current managed value, the manager made a profit)
     *      Implemented by `PoolRegistry`
     * @param poolId - the ID of the pool
     * @param token - the token asset under management
     * @param amountInvested - the new value of the managed portion of the total balance
     */
    function updateInvested(
        bytes32 poolId,
        IERC20 token,
        uint128 amountInvested
    ) external;

    //Protocol Fees

    /**
     * @notice Returns the amount in protocol fees collected for a specific token
     * @dev    Implemented by `VaultAccounting`
     * @param token - a token on which fees have accrued
     * @return protocol fees collected from the given token
     */
    function getCollectedFeesByToken(IERC20 token) external view returns (uint256);

    // Admin Controls

    /**
     * @notice Authorizes "manager" to call "addUniversalAgent". This is typically called on factory contracts.
     * @dev Can only be called by the admin
     *      Implemented by `Admin`
     * @param manager - the new universal agent manager
     */
    function addUniversalAgentManager(address manager) external;

    /**
     * @notice Revoke authorization for "manager" to call "addUniversalAgent".
     *         This is typically called on factory contracts.
     * @dev Can only be called by the admin. For instance, if a factory is found to be insecure, the protocol can
     *      prevent it from being used
     *      Implemented by `Admin`
     * @param manager - the universal agent manager being revoked
     */
    function removeUniversalAgentManager(address manager) external;

    /**
     * @notice Withdraw protocol fees, in the amounts and denominations specified. Can be called by anyone.
     * @dev Tokens are sent to the protocolFeeCollector address
     *      Implemented by `Admin`
     * @param tokens - the tokens we're collecting fees for
     * @param amounts - the amounts we're requesting to withdraw
     */
    function withdrawProtocolFees(IERC20[] calldata tokens, uint256[] calldata amounts) external;

    // Missing here: setting protocol fees, changing admin
}
