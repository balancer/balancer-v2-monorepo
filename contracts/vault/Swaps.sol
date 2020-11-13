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
        //TODO: avoid reentrancy

        // Any net token amount going into the Vault will be taken from `fundsIn.withdrawFrom`, so they must have
        // approved the caller to use their funds.
        require(isOperatorFor(fundsIn.withdrawFrom, msg.sender), "Caller is not operator");

        // Contains the swap protocol fees charged for each token
        uint128[] memory diffSwapProtocolFees = new uint128[](diffs.length);

        // Validate correctness of VaultDelta array
        // TODO: take vaultDelta out of the diffs struct, and initialize the array here instead
        for (uint256 i = 0; i < diffs.length; ++i) {
            require(diffs[i].vaultDelta == 0, "Bad workspace");
            diffSwapProtocolFees[i] = 0;
        }

        // Steps 1, 2 & 3:
        //  - check swaps are valid
        //  - update pool balances
        //  - accumulate token diffs

        for (uint256 i = 0; i < swaps.length; ++i) {
            Swap memory swap = swaps[i];

            require(swap.tokenIn.amount != 0, "Token In NOOP");
            require(swap.tokenOut.amount != 0, "Token Out NOOP");

            IERC20 tokenIn = diffs[swap.tokenIn.tokenDiffIndex].token;
            IERC20 tokenOut = diffs[swap.tokenOut.tokenDiffIndex].token;

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
            diffs[swap.tokenIn.tokenDiffIndex].vaultDelta += swap.tokenIn.amount;
            diffs[swap.tokenOut.tokenDiffIndex].vaultDelta -= swap.tokenOut.amount;

            // 3b: Accumulate token swap protocol fees
            diffSwapProtocolFees[swap.tokenIn.tokenDiffIndex] = diffSwapProtocolFees[swap.tokenIn.tokenDiffIndex]
                .add128(protocolSwapFeeAmountIn);
        }

        // Step 4: Receive tokens due to the Vault, withdrawing missing amounts from User Balance
        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta > 0) {
                uint128 received = _pullTokens(diff.token, fundsIn.withdrawFrom, diff.amountIn.toUint128());

                if (received < diff.vaultDelta) {
                    uint128 missing = uint128(diff.vaultDelta) - received;

                    require(_userTokenBalance[fundsIn.withdrawFrom][diff.token] >= missing, "ERR_INVALID_DEPOSIT");

                    _userTokenBalance[fundsIn.withdrawFrom][diff.token] -= missing;
                }
            }
        }

        // Step 5: Send tokens due to the recipient
        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];

            if (diff.vaultDelta < 0) {
                // Make delta positive
                uint128 amount = uint128(-diff.vaultDelta);

                if (fundsOut.transferToRecipient) {
                    // Actually transfer the tokens to the recipient
                    _pushTokens(diff.token, fundsOut.recipient, amount, false);
                } else {
                    // Deposit tokens to the recipient's User Balance - the Vault's balance doesn't change
                    _userTokenBalance[fundsOut.recipient][diff.token] = _userTokenBalance[fundsOut.recipient][diff
                        .token]
                        .add128(amount);
                }
            }
        }

        // Step 6: Deduct swap protocol swap fees from the Vault's balance - this makes them unaccounted-for
        for (uint256 i = 0; i < diffs.length; ++i) {
            Diff memory diff = diffs[i];
            _vaultTokenBalance[diff.token] = _vaultTokenBalance[diff.token].decrease(diffSwapProtocolFees[i]);
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
        (address strategy, StrategyType strategyType) = fromPoolId(swap.poolId);

        if (strategyType == StrategyType.PAIR) {
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
                    IPairTradingStrategy(strategy)
                );
        } else if (strategyType == StrategyType.TUPLE) {
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
                    ITupleTradingStrategy(strategy)
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
