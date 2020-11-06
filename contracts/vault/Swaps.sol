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

    function batchSwap(
        Diff[] memory diffs,
        Swap[] memory swaps,
        FundsIn calldata fundsIn,
        FundsOut calldata fundsOut
    ) external override {
        require(
            isOperatorFor(fundsIn.withdrawFrom, msg.sender),
            "Caller is not operator"
        );

        //TODO: avoid reentrancy

        // TODO: check tokens in diffs are unique. Is this necessary? Would avoid multiple valid diff
        // indexes pointing to the same token.
        // A simple way to implement this is to require the addresses to be sorted, and require strict
        // inequality

        uint128[] memory diffProtocolFees = new uint128[](diffs.length);

        for (uint256 i = 0; i < diffs.length; ++i) {
            require(diffs[i].vaultDelta == 0, "Bad workspace");
            diffProtocolFees[i] = 0;
        }

        // TODO: check each pool only appears in a single swap. Might be overly restrictive, but easy
        // to implement (require swaps array to be sorted by poolId).

        // Steps 1, 2 & 3:
        //  - validate hints
        //  - check new pool balances are valid
        //  - accumulate token diffs
        //  - update pool balances

        for (uint256 i = 0; i < swaps.length; ++i) {
            Swap memory swap = swaps[i];

            require(swap.tokenIn.amount != 0, "Token In NOOP");
            require(swap.tokenOut.amount != 0, "Token Out NOOP");

            address tokenIn = diffs[swap.tokenIn.tokenDiffIndex].token;
            address tokenOut = diffs[swap.tokenOut.tokenDiffIndex].token;

            // 1.2: Accumulate token diffs
            diffs[swap.tokenIn.tokenDiffIndex].vaultDelta += swap
                .tokenIn
                .amount;
            diffs[swap.tokenOut.tokenDiffIndex].vaultDelta -= swap
                .tokenOut
                .amount;

            (
                BalanceLib.Balance memory tokenInFinalBalance,
                BalanceLib.Balance memory tokenOutFinalBalance,
                uint128 protocolSwapFeeAmountIn
            ) = _validateSwap(
                fundsIn.withdrawFrom,
                fundsOut.recipient,
                swap,
                tokenIn,
                tokenOut
            );

            diffProtocolFees[swap
                .tokenIn
                .tokenDiffIndex] = diffProtocolFees[swap.tokenIn.tokenDiffIndex]
                .add128(protocolSwapFeeAmountIn);

            // 3: update pool balances

            _poolTokenBalance[swap.poolId][tokenIn] = tokenInFinalBalance;
            _poolTokenBalance[swap.poolId][tokenOut] = tokenOutFinalBalance;
        }

        // Step 4: Receive intended tokens, pulling the difference from user balance
        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta > 0) {
                // TODO: skip _pullTokens if diff.amountIn is 0
                uint128 received = _pullTokens(
                    diff.token,
                    fundsIn.withdrawFrom,
                    diff.amountIn.toUint128()
                );

                if (received < diff.vaultDelta) {
                    uint128 missing = uint128(diff.vaultDelta) - received;

                    require(
                        _userTokenBalance[fundsIn.withdrawFrom][diff.token] >=
                            missing,
                        "ERR_INVALID_DEPOSIT"
                    );

                    _userTokenBalance[fundsIn.withdrawFrom][diff
                        .token] -= missing;
                }
            }
        }

        // Step 5: send out tokens to send
        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta < 0) {
                // Make delta positive
                uint128 amount = uint128(-diff.vaultDelta);

                if (fundsOut.transferToRecipient) {
                    // Actually transfer the tokens to the recipient
                    _pushTokens(diff.token, fundsOut.recipient, amount, false);
                } else {
                    // Allocate tokens to the recipient as user balance - the vault's balance doesn't change
                    _userTokenBalance[fundsOut.recipient][diff
                        .token] = _userTokenBalance[fundsOut.recipient][diff
                        .token]
                        .add128(amount);
                }
            }
        }

        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];
            _vaultTokenBalance[diff.token] = _vaultTokenBalance[diff.token]
                .decrease(diffProtocolFees[i]);
        }
    }

    function _validateSwap(
        address from,
        address to,
        Swap memory swap,
        address tokenIn,
        address tokenOut
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

    function _validatePairStrategySwap(
        ITradingStrategy.Swap memory swap,
        IPairTradingStrategy strategy
    )
        private
        returns (
            BalanceLib.Balance memory,
            BalanceLib.Balance memory,
            uint128
        )
    {
        BalanceLib.Balance memory poolTokenInBalance = _poolTokenBalance[swap
            .poolId][swap.tokenIn];
        require(poolTokenInBalance.total > 0, "Token A not in pool");

        BalanceLib.Balance memory poolTokenOutBalance = _poolTokenBalance[swap
            .poolId][swap.tokenOut];
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

    function _validateTupleStrategySwap(
        ITradingStrategy.Swap memory swap,
        ITupleTradingStrategy strategy
    )
        private
        returns (
            BalanceLib.Balance memory,
            BalanceLib.Balance memory,
            uint128
        )
    {
        uint128[] memory currentBalances = new uint128[](
            _poolTokens[swap.poolId].length()
        );

        uint256 indexIn;
        uint256 indexOut;

        BalanceLib.Balance memory balanceIn;
        BalanceLib.Balance memory balanceOut;

        for (uint256 i = 0; i < _poolTokens[swap.poolId].length(); i++) {
            address token = _poolTokens[swap.poolId].at(i);
            BalanceLib.Balance memory balance = _poolTokenBalance[swap
                .poolId][token];

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

        (bool success, uint128 tokenInFeeAmount) = strategy.validateTuple(
            swap,
            currentBalances,
            indexIn,
            indexOut
        );
        require(success, "invariant validation failed");

        uint128 protocolSwapFee = _calculateProtocolSwapFee(tokenInFeeAmount);

        return (
            balanceIn.increase(swap.amountIn.sub128(protocolSwapFee)),
            balanceOut.decrease(swap.amountOut),
            protocolSwapFee
        );
    }
}
