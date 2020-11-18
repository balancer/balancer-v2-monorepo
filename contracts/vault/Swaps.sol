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
import "@openzeppelin/contracts/math/Math.sol";

import "../math/FixedPoint.sol";

import "../strategies/v2/ITradingStrategy.sol";
import "../strategies/v2/IPairTradingStrategy.sol";
import "../strategies/v2/ITupleTradingStrategy.sol";

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

    struct SwapInternal {
        bytes32 poolId;
        uint128 tokenInIndex;
        uint128 tokenOutIndex;
        uint128 amount;
        bytes userData;
    }

    enum BatchSwapType { GIVEN_IN, GIVEN_OUT }

    function batchSwapGivenIn(
        SwapIn[] memory swaps,
        IERC20[] memory tokens,
        FundManagement memory funds
    ) external override returns (int256[] memory) {
        return _batchSwap(_toInternalSwap(swaps), tokens, funds, BatchSwapType.GIVEN_IN);
    }

    function batchSwapGivenOut(
        SwapOut[] memory swaps,
        IERC20[] memory tokens,
        FundManagement memory funds
    ) external override returns (int256[] memory) {
        return _batchSwap(_toInternalSwap(swaps), tokens, funds, BatchSwapType.GIVEN_OUT);
    }

    function _toInternalSwap(SwapIn[] memory swapsIn) private pure returns (SwapInternal[] memory swapsInternal) {
        assembly {
            swapsInternal := swapsIn
        }
    }

    function _toInternalSwap(SwapOut[] memory swapsOut) private pure returns (SwapInternal[] memory swapsInternal) {
        assembly {
            swapsInternal := swapsOut
        }
    }

    function _batchSwap(
        SwapInternal[] memory swaps,
        IERC20[] memory tokens,
        FundManagement memory funds,
        BatchSwapType kind
    ) private returns (int256[] memory) {
        //TODO: avoid reentrancy

        // Any net token amount going into the Vault will be taken from `funds.sender`, so they must have
        // approved the caller to use their funds.
        require(isOperatorFor(funds.sender, msg.sender), "Caller is not operator");

        int256[] memory tokenDeltas = new int256[](tokens.length);

        // Contains the swap protocol fees charged for each token
        uint128[] memory tokenSwapProtocolFees = new uint128[](tokens.length);

        LastSwapData memory previous;
        SwapInternal memory swap;

        // Steps 1, 2 & 3:
        //  - check swaps are valid
        //  - update pool balances
        //  - accumulate token diffs
        for (uint256 i = 0; i < swaps.length; ++i) {
            swap = swaps[i];

            (uint128 amountIn, uint128 amountOut, uint128 protocolSwapFee) = swapWithPool(
                tokens,
                swap,
                funds.sender,
                funds.recipient,
                previous,
                kind
            );

            // 3: Accumulate token diffs
            tokenDeltas[swap.tokenInIndex] += amountIn;
            tokenDeltas[swap.tokenOutIndex] -= amountOut;

            // 3b: Accumulate token swap protocol fees
            tokenSwapProtocolFees[swap.tokenInIndex] = tokenSwapProtocolFees[swap.tokenInIndex].add128(protocolSwapFee);
        }

        // Step 4: Receive tokens due to the Vault, withdrawing missing amounts from User Balance
        // Step 5: Send tokens due to the recipient
        // Step 6: Deduct swap protocol swap fees from the Vault's balance - this makes them unaccounted-for
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];

            if (tokenDeltas[i] > 0) {
                uint128 toReceive = uint128(tokenDeltas[i]);

                if (funds.withdrawFromUserBalance) {
                    uint128 toWithdraw = uint128(Math.min(_userTokenBalance[funds.sender][token], toReceive));

                    _userTokenBalance[funds.sender][token] -= toWithdraw;
                    toReceive -= toWithdraw;
                }

                uint128 received = _pullTokens(token, funds.sender, toReceive);
                require(received == toReceive);
            } else {
                // Make delta positive
                uint128 toSend = uint128(-tokenDeltas[i]);

                if (funds.depositToUserBalance) {
                    // Deposit tokens to the recipient's User Balance - the Vault's balance doesn't change
                    _userTokenBalance[funds.recipient][token] = _userTokenBalance[funds.recipient][token].add128(
                        toSend
                    );
                } else {
                    // Actually transfer the tokens to the recipient
                    _pushTokens(token, funds.recipient, toSend, false);
                }
            }

            _vaultTokenBalance[token] = _vaultTokenBalance[token].decrease(tokenSwapProtocolFees[i]);
        }

        return tokenDeltas;
    }

    struct LastSwapData {
        // For swaps of kind GIVEN_IN, these are tokenOut and amountOut. For GIVEN_OUT, they are tokenIn and amountIn.
        // This struct should not be explicitly initialized: the default token value of IERC20(0) signals the first
        // swap.
        IERC20 tokenQuoted;
        uint128 amountQuoted;
    }

    function swapWithPool(
        IERC20[] memory tokens,
        SwapInternal memory swap,
        address from,
        address to,
        LastSwapData memory previous,
        BatchSwapType kind
    )
        private
        returns (
            uint128,
            uint128,
            uint128
        )
    {
        IERC20 tokenIn = tokens[swap.tokenInIndex];
        IERC20 tokenOut = tokens[swap.tokenOutIndex];
        require(tokenIn != tokenOut, "Swap for same token");

        uint128 amountGiven = swap.amount;
        if (amountGiven == 0) {
            require(previous.tokenQuoted != IERC20(0), "Unknown amount in on first swap");
            require(previous.tokenQuoted == _tokenGiven(kind, tokenIn, tokenOut), "Misconstructed multihop swap");

            amountGiven = previous.amountQuoted;
        }

        QuoteRequestInternal memory request = QuoteRequestInternal({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amount: amountGiven,
            poolId: swap.poolId,
            from: from,
            to: to,
            userData: swap.userData
        });

        (uint128 amountQuoted, uint128 protocolSwapFee) = _processQuoteRequest(request, kind);

        previous.tokenQuoted = _tokenQuoted(kind, tokenIn, tokenOut);
        previous.amountQuoted = amountQuoted;

        if (kind == BatchSwapType.GIVEN_IN) {
            return (amountGiven, amountQuoted, protocolSwapFee);
        } else {
            return (amountQuoted, amountGiven, protocolSwapFee);
        }
    }

    function _tokenGiven(
        BatchSwapType kind,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) private pure returns (IERC20) {
        return kind == BatchSwapType.GIVEN_IN ? tokenIn : tokenOut;
    }

    function _tokenQuoted(
        BatchSwapType kind,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) private pure returns (IERC20) {
        return kind == BatchSwapType.GIVEN_IN ? tokenOut : tokenIn;
    }

    struct QuoteRequestInternal {
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint128 amount;
        bytes32 poolId;
        address from;
        address to;
        bytes userData;
    }

    function _toQuoteGivenIn(QuoteRequestInternal memory requestInternal)
        private
        pure
        returns (ITradingStrategy.QuoteRequestGivenIn memory requestGivenIn)
    {
        assembly {
            requestGivenIn := requestInternal
        }
    }

    function _toQuoteGivenOut(QuoteRequestInternal memory requestInternal)
        private
        pure
        returns (ITradingStrategy.QuoteRequestGivenOut memory requestGivenOut)
    {
        assembly {
            requestGivenOut := requestInternal
        }
    }

    function _processQuoteRequest(QuoteRequestInternal memory request, BatchSwapType kind)
        private
        returns (uint128, uint128)
    {
        PoolStrategy memory strategy = _poolStrategy[request.poolId];

        BalanceLib.Balance memory tokenInFinalBalance;
        BalanceLib.Balance memory tokenOutFinalBalance;

        uint128 amountQuoted;
        uint128 protocolSwapFee;

        if (strategy.strategyType == StrategyType.PAIR) {
            (
                tokenInFinalBalance,
                tokenOutFinalBalance,
                amountQuoted,
                protocolSwapFee
            ) = _processPairTradingStrategyQuoteRequest(request, IPairTradingStrategy(strategy.strategy), kind);
        } else if (strategy.strategyType == StrategyType.TUPLE) {
            (
                tokenInFinalBalance,
                tokenOutFinalBalance,
                amountQuoted,
                protocolSwapFee
            ) = _processTupleTradingStrategyQuoteRequest(request, ITupleTradingStrategy(strategy.strategy), kind);
        } else {
            revert("Unknown strategy type");
        }

        // 2: Update Pool balances - these have been deducted the swap protocol fees
        _poolTokenBalance[request.poolId][request.tokenIn] = tokenInFinalBalance;
        _poolTokenBalance[request.poolId][request.tokenOut] = tokenOutFinalBalance;

        return (amountQuoted, protocolSwapFee);
    }

    function _processPairTradingStrategyQuoteRequest(
        QuoteRequestInternal memory request,
        IPairTradingStrategy strategy,
        BatchSwapType kind
    )
        private
        returns (
            BalanceLib.Balance memory,
            BalanceLib.Balance memory,
            uint128,
            uint128
        )
    {
        BalanceLib.Balance memory poolTokenInBalance = _poolTokenBalance[request.poolId][request.tokenIn];
        require(poolTokenInBalance.total > 0, "Token A not in pool");

        BalanceLib.Balance memory poolTokenOutBalance = _poolTokenBalance[request.poolId][request.tokenOut];
        require(poolTokenOutBalance.total > 0, "Token B not in pool");

        if (kind == BatchSwapType.GIVEN_IN) {
            (uint128 amountOut, uint128 tokenInFeeAmount) = strategy.quoteOutGivenIn(
                _toQuoteGivenIn(request),
                poolTokenInBalance.total,
                poolTokenOutBalance.total
            );

            uint128 protocolSwapFee = _calculateProtocolSwapFee(tokenInFeeAmount);

            return (
                poolTokenInBalance.increase(request.amount.sub128(protocolSwapFee)),
                poolTokenOutBalance.decrease(amountOut),
                amountOut,
                protocolSwapFee
            );
        } else {
            (uint128 amountIn, uint128 tokenInFeeAmount) = strategy.quoteInGivenOut(
                _toQuoteGivenOut(request),
                poolTokenInBalance.total,
                poolTokenOutBalance.total
            );

            uint128 protocolSwapFee = _calculateProtocolSwapFee(tokenInFeeAmount);

            return (
                poolTokenInBalance.increase(amountIn.sub128(protocolSwapFee)),
                poolTokenOutBalance.decrease(request.amount),
                amountIn,
                protocolSwapFee
            );
        }
    }

    // TODO: Temporary struct to workaround stack-too-deep: remove once #73 is implemented
    struct Helper {
        uint256 indexIn;
        uint256 indexOut;
    }

    function _processTupleTradingStrategyQuoteRequest(
        QuoteRequestInternal memory request,
        ITupleTradingStrategy strategy,
        BatchSwapType kind
    )
        private
        returns (
            BalanceLib.Balance memory balanceIn,
            BalanceLib.Balance memory balanceOut,
            uint128,
            uint128 protocolSwapFee
        )
    {
        uint128[] memory currentBalances = new uint128[](_poolTokens[request.poolId].length());

        Helper memory helper;

        for (uint256 i = 0; i < _poolTokens[request.poolId].length(); i++) {
            IERC20 token = IERC20(_poolTokens[request.poolId].at(i));
            BalanceLib.Balance memory balance = _poolTokenBalance[request.poolId][token];

            currentBalances[i] = balance.total;

            if (token == request.tokenIn) {
                helper.indexIn = i;
                balanceIn = balance;
            } else if (token == request.tokenOut) {
                helper.indexOut = i;
                balanceOut = balance;
            }
        }

        require(balanceIn.total > 0, "Token A not in pool");
        require(balanceOut.total > 0, "Token B not in pool");

        if (kind == BatchSwapType.GIVEN_IN) {
            (uint128 amountOut, uint128 tokenInFeeAmount) = strategy.quoteOutGivenIn(
                _toQuoteGivenIn(request),
                currentBalances,
                helper.indexIn,
                helper.indexOut
            );

            protocolSwapFee = _calculateProtocolSwapFee(tokenInFeeAmount);

            return (
                balanceIn.increase(request.amount.sub128(protocolSwapFee)),
                balanceOut.decrease(amountOut),
                amountOut,
                protocolSwapFee
            );
        } else {
            (uint128 amountIn, uint128 tokenInFeeAmount) = strategy.quoteInGivenOut(
                _toQuoteGivenOut(request),
                currentBalances,
                helper.indexIn,
                helper.indexOut
            );

            protocolSwapFee = _calculateProtocolSwapFee(tokenInFeeAmount);

            return (
                balanceIn.increase(amountIn.sub128(protocolSwapFee)),
                balanceOut.decrease(request.amount),
                amountIn,
                protocolSwapFee
            );
        }
    }
}
