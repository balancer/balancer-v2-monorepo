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
import "../validators/ISwapValidator.sol";

pragma solidity ^0.7.1;

// Full external interface for the Vault core contract - no external or public methods exist in the contract that don't
// override one of these declarations.
interface IVault {
    // User Balance

    /**
     * @dev Returns `user`'s User Balance for a specific token.
     */
    function getUserTokenBalance(address user, IERC20 token) external view returns (uint128);

    /**
     * @dev Deposits tokens from the caller into `user`'s User Balance.
     */
    function deposit(
        IERC20 token,
        uint128 amount,
        address user
    ) external;

    /**
     * @dev Withdraws tokens from the caller's User Balance, transferring them to `recipient`. Withdraw protocol fees
     * are charged by this.
     */
    function withdraw(
        IERC20 token,
        uint128 amount,
        address recipient
    ) external;

    // Operators

    /**
     * @dev Authorizes `operator` to act as an operator for the caller.
     */
    function authorizeOperator(address operator) external;

    /**
     * @dev Revokes `operator` so that it no longer is an operator for the caller. An account is always its own operator
     * and cannot revoke itself. Trusted Operators also cannot be revoked.
     */
    function revokeOperator(address operator) external;

    /**
     * @dev Returns true of `operator` is an operator for `user`.
     */
    function isOperatorFor(address user, address operator) external view returns (bool);

    /**
     * @dev Returns the number of operators for `user`. This does not include `user` itself, nor Trusted Operators.
     */
    function getUserTotalOperators(address user) external view returns (uint256);

    /**
     * @dev Returns a partial list of `user`'s operators, starting at index `start`, up to index `end`. This does not
     * include `user` itself, nor Trusted Operators.
     *
     * The ordering of this list may change as operators are authorized and revoked.
     */
    function getUserOperators(
        address user,
        uint256 start,
        uint256 end
    ) external view returns (address[] memory);

    // Trusted operators

    /**
     @dev Returns the number of Trusted Operators.
     */
    function getTotalTrustedOperators() external view returns (uint256);

    /**
     * @dev Returns a partial list of Trusted Operators, starting at index `start`, up to index `end`.
     */
    function getTrustedOperators(uint256 start, uint256 end) external view returns (address[] memory);

    /**
     * @dev Returns the number of Trusted Operator Reporters.
     */
    function getTotalTrustedOperatorReporters() external view returns (uint256);

    /**
     * @dev Returns a partial list of Trusted Operator Reporters, starting at index `start`, up to index `end`.
     */
    function getTrustedOperatorReporters(uint256 start, uint256 end) external view returns (address[] memory);

    /**
     * @dev Adds `operator` as a Trusted Operator. Can only be called by a Trusted Operator Reporter.
     */
    function reportTrustedOperator(address operator) external;

    /**
     * @dev Removes `operator` as a Trusted Operator. Can only be called by a Trusted Operator Reporter.
     */
    function revokeTrustedOperator(address operator) external;

    // Pools

    // There are two variants of Trading Strategies for Pools: Pair Trading Strategies, and Tuple Trading Strategies.
    // These require different data from the Vault, which is reflected in their differing interfaces
    // (IPairTradingStrategy and ITupleTradingStrategy, respectively).
    enum StrategyType { PAIR, TUPLE }

    /**
     * @dev Creates a new Pool with a Trading Strategy and Trading Strategy Type. The caller of this function becomes
     * the Pool's controller.
     *
     * Returns the created Pool's ID. Also emits a PoolCreated event.
     */
    function newPool(address strategy, StrategyType strategyType) external returns (bytes32);

    /**
     * @dev Emitted when a Pool is created by calling `newPool`. Contains the Pool ID of the created pool.
     */
    event PoolCreated(bytes32 poolId);

    // Pool Queries

    /**
     * @dev Returns the number of Pools.
     */
    function getTotalPools() external view returns (uint256);

    /**
     * @dev Returns a partial list of Pool IDs, starting at index `start`, up to index `end`.
     */
    function getPoolIds(uint256 start, uint256 end) external view returns (bytes32[] memory);

    /**
     * @dev Returns a Pool's controller.
     */
    function getPoolController(bytes32 poolId) external view returns (address);

    /**
     * @dev Returns a Pool's Trading Strategy and Trading Strategy Type.
     */
    function getPoolStrategy(bytes32 poolId) external view returns (address, StrategyType);

    /**
     * @dev Returns all tokens in the Pool (tokens for which the Pool has balance).
     */
    function getPoolTokens(bytes32 poolId) external view returns (IERC20[] memory);

    /**
     * @dev Returns the Pool's balance of `tokens`. This might be zero if the tokens are not in the Pool.
     */
    function getPoolTokenBalances(bytes32 poolId, IERC20[] calldata tokens) external view returns (uint128[] memory);

    function getInvestablePercentage(bytes32 poolId, IERC20 token) external view returns (uint128);

    // Pool Management

    /**
     * @dev Sets a new controller for a Pool. Can only be called by its current controller.
     */
    function setPoolController(bytes32 poolId, address controller) external;

    function authorizePoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address operator
    ) external;

    function revokePoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address operator
    ) external;

    /**
     * @dev Adds liquidity into a Pool. Can only be called by its controller.
     *
     * For each token, the Pool's balance will be increased by `totalAmounts[i]`. This is achieved by first transferring
     * `amountsToTransfer[i]` tokens, and then withdrawing any amount remaining from User Balance. In both cases, the
     * tokens will come from `from`. `from` must have granted allowance to the Vault, and the caller (Pool controller)
     * must be an operator for `from`.
     *
     * If a token that was not previously in the Pool is granted balance by this function, it will become part of the
     * Pool. This is the only way tokens can be added to a Pool.
     */
    function addLiquidity(
        bytes32 poolId,
        address from,
        IERC20[] calldata tokens,
        uint128[] calldata amounts,
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
        uint128[] calldata amounts,
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
     * A swap cannot cause `tokenOut` to be fully drained. The Pools' Trading Strategies will validate each swap,
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

    // Funds in are received by `IERC20.transferFrom` from `withdrawFrom`. If received funds are not enough, they are
    // withdrawn from withdrawFrom's User Balance.
    // In any case, the caller must be an operator for withdrawFrom.
    // Funds out are deposited to recipient's User Balance, or transferred out if transferToRecipient is true.
    struct FundManagement {
        address sender;
        address recipient;
        bool withdrawFromUserBalance;
        bool depositToUserBalance;
    }

    // Flash Loan interface
    // Flash Loan interface
    function flashLoan(
        IFlashLoanReceiver receiver,
        IERC20 token,
        uint256 amount,
        bytes calldata userData
    ) external;

    // Investment interface
    function setInvestablePercentage(
        bytes32 poolId,
        IERC20 token,
        uint128 percentage
    ) external;

    function updateInvested(
        bytes32 poolId,
        IERC20 token,
        uint128 amountInvested
    ) external;

    // Admin Controls

    /**
     * @dev Authorizes `reporter` to call `reportTrustedOperator`. This is typically called on factory contracts. Can
     * only be called by the admin.
     */
    function authorizeTrustedOperatorReporter(address reporter) external;

    /**
     * @dev Remove authorization for `reporter` to call `reportTrustedOperator`. This is typically called on factory
     * contracts. Can only be called by the admin.
     */
    function revokeTrustedOperatorReporter(address reporter) external;

    // Missing here: setting protocol fees, changing admin
}
