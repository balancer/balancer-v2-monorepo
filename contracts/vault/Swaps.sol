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
pragma experimental ABIEncoderV2;

import "hardhat/console.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../vendor/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../math/FixedPoint.sol";

import "../strategies/ITradingStrategy.sol";
import "../strategies/IPairTradingStrategy.sol";
import "../strategies/ITupleTradingStrategy.sol";

import "./IVault.sol";
import "./VaultAccounting.sol";
import "./PoolRegistry.sol";
import "./UserBalance.sol";

abstract contract Swaps is IVault, VaultAccounting, UserBalance, PoolRegistry {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using BalanceLib for BalanceLib.Balance;
    using FixedPoint for uint256;
    using FixedPoint for uint128;
    using SafeCast for uint256;
    using SafeCast for uint128;

    function batchSwap(
        Swap[] memory swaps,
        IERC20[] memory tokens, // tokens involved in the trade, as indexed by swaps
        FundsIn calldata fundsIn,
        FundsOut calldata fundsOut
    ) external override {
        //TODO: avoid reentrancy

        // Any net token amount going into the Vault will be taken from `fundsIn.withdrawFrom`, so they must have
        // approved the caller to use their funds.
        require(isOperatorFor(fundsIn.withdrawFrom, msg.sender), "Caller is not operator");

        int128[] memory tokenDeltas = new int128[](tokens.length);

        // Contains the swap protocol fees charged for each token
        uint128[] memory tokenSwapProtocolFees = new uint128[](tokens.length);

        // Steps 1, 2 & 3:
        //  - check swaps are valid
        //  - update pool balances
        //  - accumulate token diffs

        for (uint256 i = 0; i < swaps.length; ++i) {
            Swap memory swap = swaps[i];

            require(swap.tokenIn.amount != 0, "Token In NOOP");
            require(swap.tokenOut.amount != 0, "Token Out NOOP");

            IERC20 tokenIn = tokens[swap.tokenIn.tokenDiffIndex];
            IERC20 tokenOut = tokens[swap.tokenOut.tokenDiffIndex];

            require(tokenIn != tokenOut, "Swap for same token");

            // 1: Validate swap using the Pool's Trading Strategy
            (
                BalanceLib.Balance memory tokenInFinalBalance,
                BalanceLib.Balance memory tokenOutFinalBalance,
                uint128 protocolSwapFeeAmountIn
            ) = _validateSwap(fundsIn.withdrawFrom, fundsOut.recipient, swap, tokenIn, tokenOut);

            // 2: Update Pool balances - these have been deducted the swap protocol fees
            _poolTokenBalance[swap.poolId][tokenIn] = tokenInFinalBalance;
            _poolTokenBalance[swap.poolId][tokenOut] = tokenOutFinalBalance;

            // 3: Accumulate token diffs
            tokenDeltas[swap.tokenIn.tokenDiffIndex] += swap.tokenIn.amount.toInt128();
            tokenDeltas[swap.tokenOut.tokenDiffIndex] -= swap.tokenOut.amount.toInt128();

            // 3b: Accumulate token swap protocol fees
            tokenSwapProtocolFees[swap.tokenIn.tokenDiffIndex] = tokenSwapProtocolFees[swap.tokenIn.tokenDiffIndex]
                .add128(protocolSwapFeeAmountIn);
        }

        // Step 4: Receive tokens due to the Vault, withdrawing missing amounts from User Balance
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];

            if (tokenDeltas[i] > 0) {
                uint128 received = _pullTokens(token, fundsIn.withdrawFrom, fundsIn.amounts[i]);

                if (received < uint128(tokenDeltas[i])) {
                    uint128 missing = uint128(tokenDeltas[i]) - received;

                    require(_userTokenBalance[fundsIn.withdrawFrom][token] >= missing, "ERR_INVALID_DEPOSIT");

                    _userTokenBalance[fundsIn.withdrawFrom][token] -= missing;
                }
            }
        }

        // Step 5: Send tokens due to the recipient
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];

            if (tokenDeltas[i] < 0) {
                // Make delta positive
                uint128 amount = uint128(-tokenDeltas[i]);

                if (fundsOut.transferToRecipient) {
                    // Actually transfer the tokens to the recipient
                    _pushTokens(token, fundsOut.recipient, amount, false);
                } else {
                    // Deposit tokens to the recipient's User Balance - the Vault's balance doesn't change
                    _userTokenBalance[fundsOut.recipient][token] = _userTokenBalance[fundsOut.recipient][token].add128(
                        amount
                    );
                }
            }
        }

        // Step 6: Deduct swap protocol swap fees from the Vault's balance - this makes them unaccounted-for
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            _vaultTokenBalance[token] = _vaultTokenBalance[token].decrease(tokenSwapProtocolFees[i]);
        }
    }

    /**
     * @dev Validates a swap with a Pool by calling into its Trading Strategy. Reverts if the swap is rejected.
     *
     * Returns the Pool's final balances for tokenIn and tokenOut. tokenIn is applied swap protocol fees, which are also
     * returned.
     */
    function _validateSwap(
        address from,
        address to,
        Swap memory swap,
        IERC20 tokenIn,
        IERC20 tokenOut
    )
        private
        returns (
            BalanceLib.Balance memory,
            BalanceLib.Balance memory,
            uint128
        )
    {
        PoolStrategy memory strategy = _poolStrategy[swap.poolId];

        if (strategy.strategyType == StrategyType.PAIR) {
            return
                _validatePairStrategySwap(
                    ITradingStrategy.Swap({
                        poolId: swap.poolId,
                        from: from,
                        to: to,
                        tokenIn: tokenIn,
                        tokenOut: tokenOut,
                        amountIn: swap.tokenIn.amount,
                        amountOut: swap.tokenOut.amount,
                        userData: swap.userData
                    }),
                    IPairTradingStrategy(strategy.strategy)
                );
        } else if (strategy.strategyType == StrategyType.TUPLE) {
            return
                _validateTupleStrategySwap(
                    ITradingStrategy.Swap({
                        poolId: swap.poolId,
                        from: from,
                        to: to,
                        tokenIn: tokenIn,
                        tokenOut: tokenOut,
                        amountIn: swap.tokenIn.amount,
                        amountOut: swap.tokenOut.amount,
                        userData: swap.userData
                    }),
                    ITupleTradingStrategy(strategy.strategy)
                );
        } else {
            revert("Unknown strategy type");
        }
    }

    function _validatePairStrategySwap(ITradingStrategy.Swap memory swap, IPairTradingStrategy strategy)
        private
        returns (
            BalanceLib.Balance memory,
            BalanceLib.Balance memory,
            uint128
        )
    {
        BalanceLib.Balance memory poolTokenInBalance = _poolTokenBalance[swap.poolId][swap.tokenIn];
        require(poolTokenInBalance.total > 0, "Token A not in pool");

        BalanceLib.Balance memory poolTokenOutBalance = _poolTokenBalance[swap.poolId][swap.tokenOut];
        require(poolTokenOutBalance.total > 0, "Token B not in pool");

        (bool success, uint128 tokenInFeeAmount) = strategy.validatePair(
            swap,
            poolTokenInBalance.total,
            poolTokenOutBalance.total
        );
        require(success, "pair validation failed");

        uint128 protocolSwapFee = _calculateProtocolSwapFee(tokenInFeeAmount);

        return (
            poolTokenInBalance.increase(swap.amountIn.sub128(protocolSwapFee)),
            poolTokenOutBalance.decrease(swap.amountOut),
            protocolSwapFee
        );
    }

    function _validateTupleStrategySwap(ITradingStrategy.Swap memory swap, ITupleTradingStrategy strategy)
        private
        returns (
            BalanceLib.Balance memory,
            BalanceLib.Balance memory,
            uint128
        )
    {
        uint128[] memory currentBalances = new uint128[](_poolTokens[swap.poolId].length());

        uint256 indexIn;
        uint256 indexOut;

        BalanceLib.Balance memory balanceIn;
        BalanceLib.Balance memory balanceOut;

        for (uint256 i = 0; i < _poolTokens[swap.poolId].length(); i++) {
            IERC20 token = IERC20(_poolTokens[swap.poolId].at(i));
            BalanceLib.Balance memory balance = _poolTokenBalance[swap.poolId][token];

            currentBalances[i] = balance.total;
            require(currentBalances[i] > 0, "Token A not in pool");

            if (token == swap.tokenIn) {
                indexIn = i;
                balanceIn = balance;
            } else if (token == swap.tokenOut) {
                indexOut = i;
                balanceOut = balance;
            }
        }

        (bool success, uint128 tokenInFeeAmount) = strategy.validateTuple(swap, currentBalances, indexIn, indexOut);
        require(success, "invariant validation failed");

        uint128 protocolSwapFee = _calculateProtocolSwapFee(tokenInFeeAmount);

        return (
            balanceIn.increase(swap.amountIn.sub128(protocolSwapFee)),
            balanceOut.decrease(swap.amountOut),
            protocolSwapFee
        );
    }
}
