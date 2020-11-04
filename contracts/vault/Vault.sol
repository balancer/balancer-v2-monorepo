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

contract Vault is IVault, VaultAccounting, UserBalance, PoolRegistry {
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

        for (uint256 i = 0; i < diffs.length; ++i) {
            require(diffs[i].vaultDelta == 0, "Bad workspace");
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
                uint128 tokenInFinalBalance,
                uint128 tokenOutFinalBalance
            ) = _validateSwap(swap, tokenIn, tokenOut);

            // 3: update pool balances

            // TODO: optimize this so we don't end up reading from the same storage slots multiple times
            uint128 numTokensIn = tokenInFinalBalance.sub128(
                _poolTokenBalance[swap.poolId][tokenIn].total
            );
            uint128 numTokensOut = _poolTokenBalance[swap.poolId][tokenOut]
                .total
                .sub128(tokenOutFinalBalance);

            _poolTokenBalance[swap.poolId][tokenIn] = _poolTokenBalance[swap
                .poolId][tokenIn]
                .increase(numTokensIn);

            _poolTokenBalance[swap.poolId][tokenOut] = _poolTokenBalance[swap
                .poolId][tokenOut]
                .decrease(numTokensOut);
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
                    _pushTokens(diff.token, fundsOut.recipient, amount);
                } else {
                    // Allocate tokens to the recipient as user balance - the vault's balance doesn't change
                    _userTokenBalance[fundsOut.recipient][diff
                        .token] = _userTokenBalance[fundsOut.recipient][diff
                        .token]
                        .add128(amount);
                }
            }
        }
    }

    function _validateSwap(
        Swap memory swap,
        address tokenIn,
        address tokenOut
    ) private returns (uint128, uint128) {
        PoolStrategy memory strategy = _poolStrategy[swap.poolId];

        if (strategy.strategyType == StrategyType.PAIR) {
            return
                _validatePairStrategySwap(
                    swap.poolId,
                    tokenIn,
                    tokenOut,
                    swap.tokenIn.amount,
                    swap.tokenOut.amount,
                    IPairTradingStrategy(strategy.strategy)
                );
        } else if (strategy.strategyType == StrategyType.TUPLE) {
            return
                _validateTupleStrategySwap(
                    ITradingStrategy.Swap({
                        poolId: swap.poolId,
                        tokenIn: tokenIn,
                        tokenOut: tokenOut,
                        amountIn: swap.tokenIn.amount,
                        amountOut: swap.tokenOut.amount
                    }),
                    ITupleTradingStrategy(strategy.strategy)
                );
        } else {
            revert("Unknown strategy type");
        }
    }

    function _validatePairStrategySwap(
        bytes32 poolId,
        address tokenIn,
        address tokenOut,
        uint128 amountIn,
        uint128 amountOut,
        IPairTradingStrategy strategy
    ) private returns (uint128, uint128) {
        uint128 poolTokenInBalance = _poolTokenBalance[poolId][tokenIn].total;
        require(poolTokenInBalance > 0, "Token A not in pool");

        uint128 poolTokenOutBalance = _poolTokenBalance[poolId][tokenOut].total;
        require(poolTokenOutBalance > 0, "Token B not in pool");

        (bool success, ) = strategy.validatePair(
            ITradingStrategy.Swap({
                poolId: poolId,
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: amountIn,
                amountOut: amountOut
            }),
            poolTokenInBalance,
            poolTokenOutBalance
        );
        require(success, "pair validation failed");

        return (
            // TODO: make sure the protocol fees are not accounted for!
            // currentBalances[indexIn] + amountIn - bmul(feeAmountIn, 0), // feeAmountIn * protocolfee
            poolTokenInBalance + amountIn,
            poolTokenOutBalance - amountOut
        );
    }

    function _validateTupleStrategySwap(
        ITradingStrategy.Swap memory swap,
        ITupleTradingStrategy strategy
    ) private returns (uint128, uint128) {
        uint128[] memory currentBalances = new uint128[](
            _poolTokens[swap.poolId].length()
        );

        uint256 indexIn;
        uint256 indexOut;

        for (uint256 i = 0; i < _poolTokens[swap.poolId].length(); i++) {
            address token = _poolTokens[swap.poolId].at(i);
            currentBalances[i] = _poolTokenBalance[swap.poolId][token].total;
            require(currentBalances[i] > 0, "Token A not in pool");

            if (token == swap.tokenIn) {
                indexIn = i;
            } else if (token == swap.tokenOut) {
                indexOut = i;
            }
        }

        (bool success, ) = strategy.validateTuple(
            swap,
            currentBalances,
            indexIn,
            indexOut
        );
        require(success, "invariant validation failed");

        return (
            // TODO: make sure the protocol fees are not accounted for!
            // currentBalances[indexIn] + amountIn - bmul(feeAmountIn, 0), // feeAmountIn * protocolfee
            currentBalances[indexIn] + swap.amountIn,
            currentBalances[indexOut] - swap.amountOut
        );
    }
}
