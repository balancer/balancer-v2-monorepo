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
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/Math.sol";

import "../math/FixedPoint.sol";

import "../strategies/ITradingStrategy.sol";
import "../strategies/IPairTradingStrategy.sol";
import "../strategies/ITupleTradingStrategy.sol";

import "../validators/ISwapValidator.sol";

import "./IVault.sol";
import "./PoolBalance.sol";
import "./VaultAccounting.sol";
import "./PoolRegistry.sol";
import "./UserBalance.sol";

abstract contract Swaps is ReentrancyGuard, IVault, VaultAccounting, UserBalance, PoolRegistry {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using PoolBalance for bytes32;
    using FixedPoint for uint256;
    using FixedPoint for uint128;
    using SafeCast for uint256;
    using SafeCast for uint128;

    // This struct is identical in layout to SwapIn and SwapOut, except the 'amountIn/Out' field is named 'amount'.
    struct SwapInternal {
        bytes32 poolId;
        uint128 tokenInIndex;
        uint128 tokenOutIndex;
        uint128 amount;
        bytes userData;
    }

    function batchSwapGivenIn(
        ISwapValidator validator,
        bytes calldata validatorData,
        SwapIn[] memory swaps,
        IERC20[] calldata tokens,
        FundManagement calldata funds
    ) external override {
        int256[] memory tokenDeltas = _batchSwap(_toInternalSwap(swaps), tokens, funds, SwapKind.GIVEN_IN);
        if (address(validator) != address(0)) {
            validator.validate(SwapKind.GIVEN_IN, tokens, tokenDeltas, validatorData);
        }
    }

    function batchSwapGivenOut(
        ISwapValidator validator,
        bytes calldata validatorData,
        SwapOut[] memory swaps,
        IERC20[] calldata tokens,
        FundManagement calldata funds
    ) external override {
        int256[] memory tokenDeltas = _batchSwap(_toInternalSwap(swaps), tokens, funds, SwapKind.GIVEN_OUT);
        if (address(validator) != address(0)) {
            validator.validate(SwapKind.GIVEN_OUT, tokens, tokenDeltas, validatorData);
        }
    }

    // We use inline assembly to cast from the external struct types to the internal one. This doesn't trigger any
    // conversions or runtime analysis: it is just coercing the type system to reinterpret the data as another type.

    function _toInternalSwap(SwapIn[] memory swapsIn) private pure returns (SwapInternal[] memory swapsInternal) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            swapsInternal := swapsIn
        }
    }

    function _toInternalSwap(SwapOut[] memory swapsOut) private pure returns (SwapInternal[] memory swapsInternal) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            swapsInternal := swapsOut
        }
    }

    // This struct is identical in layout to QuoteRequestGivenIn and QuoteRequestGivenIn from ITradingStrategy, except
    // the 'amountIn/Out' is named 'amount'.
    struct QuoteRequestInternal {
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint128 amount;
        bytes32 poolId;
        address from;
        address to;
        bytes userData;
    }

    // We use inline assembly to cast from the internal struct type to the external ones, depending on the swap kind.
    // This doesn't trigger any conversions or runtime analysis: it is just coercing the type system to reinterpret the
    // data as another type.

    function _toQuoteGivenIn(QuoteRequestInternal memory requestInternal)
        private
        pure
        returns (ITradingStrategy.QuoteRequestGivenIn memory requestGivenIn)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            requestGivenIn := requestInternal
        }
    }

    function _toQuoteGivenOut(QuoteRequestInternal memory requestInternal)
        private
        pure
        returns (ITradingStrategy.QuoteRequestGivenOut memory requestGivenOut)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            requestGivenOut := requestInternal
        }
    }

    function _batchSwap(
        SwapInternal[] memory swaps,
        IERC20[] memory tokens,
        FundManagement memory funds,
        SwapKind kind
    ) private nonReentrant returns (int256[] memory) {
        //TODO: avoid reentrancy

        // Any net token amount going into the Vault will be taken from `funds.sender`, so they must have
        // approved the caller to use their funds.
        require(isOperatorFor(funds.sender, msg.sender), "Caller is not operator");

        int256[] memory tokenDeltas = new int256[](tokens.length);

        LastSwapData memory previous;
        SwapInternal memory swap;

        // Steps 1, 2 & 3:
        //  - check swaps are valid
        //  - update pool balances
        //  - accumulate token diffs
        for (uint256 i = 0; i < swaps.length; ++i) {
            swap = swaps[i];

            (uint128 amountIn, uint128 amountOut) = _swapWithPool(
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
        }

        // Step 4: Receive tokens due to the Vault, withdrawing missing amounts from User Balance
        // Step 5: Send tokens due to the recipient
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
                require(received == toReceive, "Not enough tokens received");
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
        }

        return tokenDeltas;
    }

    // This struct helps implement the multihop logic: if the amount given is not provided for a swap, then the token
    // given must match the previous token quoted, and the previous amount quoted becomes the new amount given.
    // For swaps of kind given in, amount in and token in are given, while amount out and token out quoted.
    // For swaps of kind given out, amount out and token out are given, while amount in and token in quoted.
    struct LastSwapData {
        IERC20 tokenQuoted;
        uint128 amountQuoted;
    }

    function _tokenGiven(
        SwapKind kind,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) private pure returns (IERC20) {
        return kind == SwapKind.GIVEN_IN ? tokenIn : tokenOut;
    }

    function _tokenQuoted(
        SwapKind kind,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) private pure returns (IERC20) {
        return kind == SwapKind.GIVEN_IN ? tokenOut : tokenIn;
    }

    function _getAmounts(
        SwapKind kind,
        uint128 amountGiven,
        uint128 amountQuoted
    ) private pure returns (uint128 amountIn, uint128 amountOut) {
        if (kind == SwapKind.GIVEN_IN) {
            (amountIn, amountOut) = (amountGiven, amountQuoted);
        } else {
            (amountIn, amountOut) = (amountQuoted, amountGiven);
        }
    }

    function _swapWithPool(
        IERC20[] memory tokens,
        SwapInternal memory swap,
        address from,
        address to,
        LastSwapData memory previous,
        SwapKind kind
    ) private returns (uint128 amountIn, uint128 amountOut) {
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

        uint128 amountQuoted = _processQuoteRequest(request, kind);

        previous.tokenQuoted = _tokenQuoted(kind, tokenIn, tokenOut);
        previous.amountQuoted = amountQuoted;

        (amountIn, amountOut) = _getAmounts(kind, amountGiven, amountQuoted);
    }

    function _processQuoteRequest(QuoteRequestInternal memory request, SwapKind kind)
        private
        returns (uint128 amountQuoted)
    {
        (address strategy, StrategyType strategyType) = fromPoolId(request.poolId);

        bytes32 tokenInFinalBalance;
        bytes32 tokenOutFinalBalance;

        if (strategyType == StrategyType.PAIR) {
            (tokenInFinalBalance, tokenOutFinalBalance, amountQuoted) = _processPairTradingStrategyQuoteRequest(
                request,
                IPairTradingStrategy(strategy),
                kind
            );
        } else if (strategyType == StrategyType.TUPLE) {
            (tokenInFinalBalance, tokenOutFinalBalance, amountQuoted) = _processTupleTradingStrategyQuoteRequest(
                request,
                ITupleTradingStrategy(strategy),
                kind
            );
        } else {
            revert("Unknown strategy type");
        }

        // 2: Update Pool balances - these have been deducted the swap protocol fees
        _poolTokenBalance[request.poolId][request.tokenIn] = tokenInFinalBalance;
        _poolTokenBalance[request.poolId][request.tokenOut] = tokenOutFinalBalance;
    }

    function _processPairTradingStrategyQuoteRequest(
        QuoteRequestInternal memory request,
        IPairTradingStrategy strategy,
        SwapKind kind
    )
        private
        returns (
            bytes32 poolTokenInBalance,
            bytes32 poolTokenOutBalance,
            uint128
        )
    {
        poolTokenInBalance = _poolTokenBalance[request.poolId][request.tokenIn];
        require(poolTokenInBalance.total() > 0, "Token A not in pool");

        poolTokenOutBalance = _poolTokenBalance[request.poolId][request.tokenOut];
        require(poolTokenOutBalance.total() > 0, "Token B not in pool");

        if (kind == SwapKind.GIVEN_IN) {
            (uint128 amountOut, ) = strategy.quoteOutGivenIn(
                _toQuoteGivenIn(request),
                poolTokenInBalance.total(),
                poolTokenOutBalance.total()
            );

            return (
                poolTokenInBalance.increaseCash(request.amount),
                poolTokenOutBalance.decreaseCash(amountOut),
                amountOut
            );
        } else {
            (uint128 amountIn, ) = strategy.quoteInGivenOut(
                _toQuoteGivenOut(request),
                poolTokenInBalance.total(),
                poolTokenOutBalance.total()
            );

            return (
                poolTokenInBalance.increaseCash(amountIn),
                poolTokenOutBalance.decreaseCash(request.amount),
                amountIn
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
        SwapKind kind
    )
        private
        returns (
            bytes32 poolTokenInBalance,
            bytes32 poolTokenOutBalance,
            uint128
        )
    {
        uint128[] memory currentBalances = new uint128[](_poolTokens[request.poolId].length());

        Helper memory helper;

        for (uint256 i = 0; i < _poolTokens[request.poolId].length(); i++) {
            IERC20 token = IERC20(_poolTokens[request.poolId].at(i));
            bytes32 balance = _poolTokenBalance[request.poolId][token];

            currentBalances[i] = balance.total();

            if (token == request.tokenIn) {
                helper.indexIn = i;
                poolTokenInBalance = balance;
            } else if (token == request.tokenOut) {
                helper.indexOut = i;
                poolTokenOutBalance = balance;
            }
        }

        require(poolTokenInBalance.total() > 0, "Token A not in pool");
        require(poolTokenOutBalance.total() > 0, "Token B not in pool");

        if (kind == SwapKind.GIVEN_IN) {
            (uint128 amountOut, ) = strategy.quoteOutGivenIn(
                _toQuoteGivenIn(request),
                currentBalances,
                helper.indexIn,
                helper.indexOut
            );

            return (
                poolTokenInBalance.increaseCash(request.amount),
                poolTokenOutBalance.decreaseCash(amountOut),
                amountOut
            );
        } else {
            (uint128 amountIn, ) = strategy.quoteInGivenOut(
                _toQuoteGivenOut(request),
                currentBalances,
                helper.indexIn,
                helper.indexOut
            );

            return (
                poolTokenInBalance.increaseCash(amountIn),
                poolTokenOutBalance.decreaseCash(request.amount),
                amountIn
            );
        }
    }
}
