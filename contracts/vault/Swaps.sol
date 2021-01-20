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
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "../vendor/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../vendor/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/Math.sol";

import "./interfaces/IPoolQuoteStructs.sol";
import "./interfaces/IPoolQuote.sol";
import "./interfaces/IPoolQuoteSimplified.sol";
import "./interfaces/ISwapValidator.sol";
import "./balances/BalanceAllocation.sol";

import "../math/FixedPoint.sol";

import "./PoolRegistry.sol";

abstract contract Swaps is ReentrancyGuard, PoolRegistry {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableMap for EnumerableMap.IERC20ToBytes32Map;

    using BalanceAllocation for bytes32;
    using FixedPoint for int256;
    using FixedPoint for uint256;
    using FixedPoint for uint128;
    using SafeCast for uint256;
    using SafeCast for uint128;

    // Despite the external API having two separate functions for given in and given out, internally their are handled
    // together to avoid unnecessary code duplication. This enum indicates which kind of swap we're processing.
    enum SwapKind { GIVEN_IN, GIVEN_OUT }

    // This struct is identical in layout to SwapIn and SwapOut, except the 'amountIn/Out' field is named 'amount'.
    struct SwapInternal {
        bytes32 poolId;
        uint256 tokenInIndex;
        uint256 tokenOutIndex;
        uint256 amount;
        bytes userData;
    }

    // This function is not marked non-reentrant to allow the validator to perform any subsequent calls it may need, but
    // the actual swap is reentrancy-protected by _batchSwap being non-reentrant.
    function batchSwapGivenIn(
        ISwapValidator validator,
        bytes calldata validatorData,
        SwapIn[] memory swaps,
        IERC20[] calldata tokens,
        FundManagement calldata funds
    ) external override returns (int256[] memory) {
        int256[] memory tokenDeltas = _batchSwap(_toInternalSwap(swaps), tokens, funds, SwapKind.GIVEN_IN);

        if (address(validator) != address(0)) {
            validator.validate(tokens, tokenDeltas, validatorData);
        }

        return tokenDeltas;
    }

    // This function is not marked non-reentrant to allow the validator to perform any subsequent calls it may need, but
    // the actual swap is reentrancy-protected by _batchSwap being non-reentrant.
    function batchSwapGivenOut(
        ISwapValidator validator,
        bytes calldata validatorData,
        SwapOut[] memory swaps,
        IERC20[] calldata tokens,
        FundManagement calldata funds
    ) external override returns (int256[] memory) {
        int256[] memory tokenDeltas = _batchSwap(_toInternalSwap(swaps), tokens, funds, SwapKind.GIVEN_OUT);

        if (address(validator) != address(0)) {
            validator.validate(tokens, tokenDeltas, validatorData);
        }

        return tokenDeltas;
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

    // This struct is identical in layout to QuoteRequestGivenIn and QuoteRequestGivenIn from IPoolQuoteStructs, except
    // the 'amountIn/Out' is named 'amount'.
    struct QuoteRequestInternal {
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint256 amount;
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
        returns (IPoolQuoteStructs.QuoteRequestGivenIn memory requestGivenIn)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            requestGivenIn := requestInternal
        }
    }

    function _toQuoteGivenOut(QuoteRequestInternal memory requestInternal)
        private
        pure
        returns (IPoolQuoteStructs.QuoteRequestGivenOut memory requestGivenOut)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            requestGivenOut := requestInternal
        }
    }

    /**
     * @dev Implements both `batchSwapGivenIn` and `batchSwapGivenIn` (minus the validator call), depending on the
     * `kind` value.
     */
    function _batchSwap(
        SwapInternal[] memory swaps,
        IERC20[] memory tokens,
        FundManagement memory funds,
        SwapKind kind
    ) private nonReentrant returns (int256[] memory) {
        // Any net token amount going into the Vault will be taken from `funds.sender`, so they must have
        // approved the caller to use their funds.
        require(isAgentFor(funds.sender, msg.sender), "Caller is not an agent");

        // Perform the swaps, updating the Pool balances and computing the net Vault token deltas
        int256[] memory tokenDeltas = _swapWithPools(swaps, tokens, funds, kind);

        // Process token deltas, by either transferring tokens from the sender (for positive deltas) or to the recipient
        // (for negative deltas).
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];

            if (tokenDeltas[i] > 0) {
                uint128 toReceive = uint128(tokenDeltas[i]);

                if (funds.withdrawFromInternalBalance) {
                    uint128 toWithdraw = uint128(Math.min(_internalTokenBalance[funds.sender][token], toReceive));

                    _internalTokenBalance[funds.sender][token] -= toWithdraw;
                    toReceive -= toWithdraw;
                }

                token.safeTransferFrom(funds.sender, address(this), toReceive);
            } else {
                uint128 toSend = tokenDeltas[i].abs().toUint128();

                if (funds.depositToInternalBalance) {
                    // Deposit tokens to the recipient's Internal Balance - the Vault's balance doesn't change
                    _internalTokenBalance[funds.recipient][token] = _internalTokenBalance[funds.recipient][token]
                        .add128(toSend);
                } else {
                    // Actually transfer the tokens to the recipient - note protocol withdraw fees are not charged by
                    // this
                    token.safeTransfer(funds.recipient, toSend);
                }
            }
        }

        return tokenDeltas;
    }

    // For `_batchSwap` to handle both given in and given out swaps, it internally tracks the 'given' amount (supplied
    // by the caller), and the 'quoted' one (returned by the Pool in response to the quote request).

    /**
     * @dev Given the two swap tokens and the swap kind, returns which one is the 'given' token (the one for which the
     * amount is supplied by the caller).
     */
    function _tokenGiven(
        SwapKind kind,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) private pure returns (IERC20) {
        return kind == SwapKind.GIVEN_IN ? tokenIn : tokenOut;
    }

    /**
     * @dev Given the two swap tokens and the swap kind, returns which one is the 'given' token (the one for which the
     * amount is returned by the Pool).
     */
    function _tokenQuoted(
        SwapKind kind,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) private pure returns (IERC20) {
        return kind == SwapKind.GIVEN_IN ? tokenOut : tokenIn;
    }

    /**
     * @dev Returns an ordered pair (amountIn, amountOut) given the amounts given and quoted and the swap kind.
     */
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

    // This struct helps implement the multihop logic: if the amount given is not provided for a swap, then the token
    // given must match the previous token quoted, and the previous amount quoted becomes the new amount given.
    // For swaps of kind given in, amount in and token in are given, while amount out and token out quoted.
    // For swaps of kind given out, amount out and token out are given, while amount in and token in quoted.
    struct LastSwapData {
        IERC20 tokenQuoted;
        uint128 amountQuoted;
    }

    /**
     * @dev Performs all `swaps`, requesting the Pools for quotes and updating their balances. Does not cause any
     * transfer of tokens - it instead returns the net Vault token deltas: positive if the Vault should receive tokens,
     * and negative if it should send them.
     */
    function _swapWithPools(
        SwapInternal[] memory swaps,
        IERC20[] memory tokens,
        FundManagement memory funds,
        SwapKind kind
    ) private returns (int256[] memory tokenDeltas) {
        tokenDeltas = new int256[](tokens.length);

        // Passed to _swapWithPool, which stores data about the previous swap here to implement multihop logic accross
        // swaps.
        LastSwapData memory previous;

        // This variable could be declared inside the loop, but that causes the compiler to allocate memory on each loop
        // iteration, increasing gas costs.
        SwapInternal memory swap;
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

            // Accumulate Vault deltas accross swaps
            tokenDeltas[swap.tokenInIndex] = SignedSafeMath.add(tokenDeltas[swap.tokenInIndex], amountIn);
            tokenDeltas[swap.tokenOutIndex] = SignedSafeMath.sub(tokenDeltas[swap.tokenOutIndex], amountOut);
        }

        return tokenDeltas;
    }

    /**
     * @dev Performs `swap`, updating the Pool balance. Returns a pair with the amount of tokens going into and out of
     * the Vault as a result of this swap.
     *
     * This function expects to be called successively with the same `previous` struct, which it updates internally to
     * implement multihop logic.
     */
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

        uint128 amountGiven = swap.amount.toUint128();

        // Sentinel value for multihop logic
        if (amountGiven == 0) {
            // When the amount given is not provided, we use the amount quoted for the previous swap, assuming the
            // current swap's token given is the previous' token quoted.
            // This makes it possible to e.g. swap a given amount of token A for token B, and then use the resulting
            // token B amount to swap for token C.
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

        // Get the quoted amount from the Pool and update its balances
        uint128 amountQuoted = _processQuoteRequest(request, kind);

        // Store swap information for next pass
        previous.tokenQuoted = _tokenQuoted(kind, tokenIn, tokenOut);
        previous.amountQuoted = amountQuoted;

        (amountIn, amountOut) = _getAmounts(kind, amountGiven, amountQuoted);
    }

    /**
     * @dev Performs a quote request call to the Pool and updates its balances as a result of the swap being executed.
     * The interface used for the call will depend on the Pool's optimization setting.
     *
     * Returns the token amount quoted by the Pool.
     */
    function _processQuoteRequest(QuoteRequestInternal memory request, SwapKind kind)
        private
        returns (uint128 amountQuoted)
    {
        (address pool, PoolOptimization optimization) = _getPoolData(request.poolId);

        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            amountQuoted = _processSimplifiedQuotePoolQuoteRequest(request, IPoolQuoteSimplified(pool), kind);
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            amountQuoted = _processTwoTokenPoolQuoteRequest(request, IPoolQuoteSimplified(pool), kind);
        } else {
            amountQuoted = _processStandardPoolQuoteRequest(request, IPoolQuote(pool), kind);
        }
    }

    function _processTwoTokenPoolQuoteRequest(
        QuoteRequestInternal memory request,
        IPoolQuoteSimplified pool,
        SwapKind kind
    ) private returns (uint128 amountQuoted) {
        // Due to gas efficiency reasons, this function uses low-level knowledge of how Two Token Pool balances are
        // stored internally, instead of using getters and setters for all operations.

        (
            bytes32 tokenABalance,
            bytes32 tokenBBalance,
            TwoTokenSharedBalances storage poolSharedBalances
        ) = _getTwoTokenPoolSharedBalances(request.poolId, request.tokenIn, request.tokenOut);

        // We have the two Pool balances, but we don't know which one is the token in and which one is the token out.
        bytes32 tokenInBalance;
        bytes32 tokenOutBalance;

        // In Two Token Pools, token A has a smaller address than token B
        if (request.tokenIn < request.tokenOut) {
            // in is A, out is B
            tokenInBalance = tokenABalance;
            tokenOutBalance = tokenBBalance;
        } else {
            // in is B, out is A
            tokenOutBalance = tokenABalance;
            tokenInBalance = tokenBBalance;
        }

        uint128 tokenInTotalBalance = tokenInBalance.totalBalance();
        require(tokenInTotalBalance > 0, "Token in not in pool");

        uint128 tokenOutTotalBalance = tokenOutBalance.totalBalance();
        require(tokenOutTotalBalance > 0, "Token out not in pool");

        // Perform the quote request and compute the new balances for token in and token out after the swap
        if (kind == SwapKind.GIVEN_IN) {
            uint128 amountOut = pool
                .quoteOutGivenIn(_toQuoteGivenIn(request), tokenInTotalBalance, tokenOutTotalBalance)
                .toUint128();

            tokenInBalance = tokenInBalance.increaseCash(request.amount.toUint128());
            tokenOutBalance = tokenOutBalance.decreaseCash(amountOut);

            amountQuoted = amountOut;
        } else {
            uint128 amountIn = pool
                .quoteInGivenOut(_toQuoteGivenOut(request), tokenInTotalBalance, tokenOutTotalBalance)
                .toUint128();

            tokenInBalance = tokenInBalance.increaseCash(amountIn);
            tokenOutBalance = tokenOutBalance.decreaseCash(request.amount.toUint128());

            amountQuoted = amountIn;
        }

        // We check the token ordering again to create the new shared cash packed struct
        bytes32 newSharedCash;
        if (request.tokenIn < request.tokenOut) {
            // in is A, out is B
            newSharedCash = BalanceAllocation.toSharedCash(tokenInBalance, tokenOutBalance);
        } else {
            // in is B, out is A
            newSharedCash = BalanceAllocation.toSharedCash(tokenOutBalance, tokenInBalance);
        }

        poolSharedBalances.sharedCash = newSharedCash;
    }

    function _processSimplifiedQuotePoolQuoteRequest(
        QuoteRequestInternal memory request,
        IPoolQuoteSimplified pool,
        SwapKind kind
    ) private returns (uint128 amountQuoted) {
        bytes32 tokenInBalance = _getSimplifiedQuotePoolBalance(request.poolId, request.tokenIn);
        uint128 tokenInTotalBalance = tokenInBalance.totalBalance();
        require(tokenInTotalBalance > 0, "Token A not in pool");

        bytes32 tokenOutBalance = _getSimplifiedQuotePoolBalance(request.poolId, request.tokenOut);
        uint128 tokenOutTotalBalance = tokenOutBalance.totalBalance();
        require(tokenOutTotalBalance > 0, "Token B not in pool");

        // Perform the quote request and compute the new balances for token in and token out after the swap
        if (kind == SwapKind.GIVEN_IN) {
            uint128 amountOut = pool
                .quoteOutGivenIn(_toQuoteGivenIn(request), tokenInTotalBalance, tokenOutTotalBalance)
                .toUint128();

            tokenInBalance = tokenInBalance.increaseCash(request.amount.toUint128());
            tokenOutBalance = tokenOutBalance.decreaseCash(amountOut);

            amountQuoted = amountOut;
        } else {
            uint128 amountIn = pool
                .quoteInGivenOut(_toQuoteGivenOut(request), tokenInTotalBalance, tokenOutTotalBalance)
                .toUint128();

            tokenInBalance = tokenInBalance.increaseCash(amountIn);
            tokenOutBalance = tokenOutBalance.decreaseCash(request.amount.toUint128());

            amountQuoted = amountIn;
        }

        _simplifiedQuotePoolsBalances[request.poolId][request.tokenIn] = tokenInBalance;
        _simplifiedQuotePoolsBalances[request.poolId][request.tokenOut] = tokenOutBalance;
    }

    function _processStandardPoolQuoteRequest(
        QuoteRequestInternal memory request,
        IPoolQuote pool,
        SwapKind kind
    ) private returns (uint128 amountQuoted) {
        bytes32 tokenInBalance;
        bytes32 tokenOutBalance;

        EnumerableMap.IERC20ToBytes32Map storage poolBalances = _standardPoolsBalances[request.poolId];
        uint256 indexIn = poolBalances.indexOf(request.tokenIn, "ERR_TOKEN_NOT_REGISTERED");
        uint256 indexOut = poolBalances.indexOf(request.tokenOut, "ERR_TOKEN_NOT_REGISTERED");

        uint256[] memory currentBalances = new uint256[](poolBalances.length());

        uint256 tokenAmount = currentBalances.length;
        for (uint256 i = 0; i < tokenAmount; i++) {
            // Because the iteration is bounded by `tokenAmount` and no tokens are registered or unregistered here, we
            // can use `unchecked_valueAt` as we know `i` is a valid token index, saving storage reads.
            bytes32 balance = poolBalances.unchecked_valueAt(i);

            currentBalances[i] = balance.totalBalance();

            if (i == indexIn) {
                tokenInBalance = balance;
            } else if (i == indexOut) {
                tokenOutBalance = balance;
            }
        }

        // Perform the quote request and compute the new balances for token in and token out after the swap
        if (kind == SwapKind.GIVEN_IN) {
            uint128 amountOut = pool
                .quoteOutGivenIn(_toQuoteGivenIn(request), currentBalances, indexIn, indexOut)
                .toUint128();

            amountQuoted = amountOut;
            tokenInBalance = tokenInBalance.increaseCash(request.amount.toUint128());
            tokenOutBalance = tokenOutBalance.decreaseCash(amountOut);
        } else {
            uint128 amountIn = pool
                .quoteInGivenOut(_toQuoteGivenOut(request), currentBalances, indexIn, indexOut)
                .toUint128();

            amountQuoted = amountIn;
            tokenInBalance = tokenInBalance.increaseCash(amountIn);
            tokenOutBalance = tokenOutBalance.decreaseCash(request.amount.toUint128());
        }

        // Because no token registrations or unregistrations happened between now and when we retrieved the indexes for
        // token in and token out, we can use `unchecked_setAt`, saving storage reads.
        poolBalances.unchecked_setAt(indexIn, tokenInBalance);
        poolBalances.unchecked_setAt(indexOut, tokenOutBalance);
    }

    function queryBatchSwapGivenIn(
        SwapIn[] memory swaps,
        IERC20[] calldata tokens,
        FundManagement calldata funds
    ) external override returns (int256[] memory) {
        // This function is not marked as `nonReentrant` because the underlying query mechanism relies on reentrancy
        return _callQueryBatchSwapHelper(_toInternalSwap(swaps), tokens, funds, SwapKind.GIVEN_IN);
    }

    function queryBatchSwapGivenOut(
        SwapOut[] memory swaps,
        IERC20[] calldata tokens,
        FundManagement calldata funds
    ) external override returns (int256[] memory) {
        // This function is not marked as `nonReentrant` because the underlying query mechanism relies on reentrancy
        return _callQueryBatchSwapHelper(_toInternalSwap(swaps), tokens, funds, SwapKind.GIVEN_OUT);
    }

    function _callQueryBatchSwapHelper(
        SwapInternal[] memory swaps,
        IERC20[] calldata tokens,
        FundManagement calldata funds,
        SwapKind kind
    ) private returns (int256[] memory tokenDeltas) {
        try this.queryBatchSwapHelper(swaps, tokens, funds, kind)  {
            // This call should never revert, but it is still useful to use the try-catch syntax as it provides
            // automatic decoding of the returndata.
            assert(false);
        } catch Error(string memory reason) {
            tokenDeltas = abi.decode(bytes(reason), (int256[]));
        }
    }

    /**
     * @dev Despite this function being external, it can only be called by the Vault itself, and should not be
     * considered part of the Vault's external API.
     *
     * It executes the Pool interaction part of a batch swap, asking Pools for quotes and computing the Vault deltas,
     * but without performing any token transfers. It then reverts unconditionally, returning the Vault deltas array as
     * the revert data.
     *
     * This enables an accurate implementation of queryBatchSwapGivenIn and queryBatchSwapGivenOut, since the array
     * 'returned' by this function is the result of the exact same computation a swap would perform, including the Pool
     * calls.
     */
    function queryBatchSwapHelper(
        SwapInternal[] memory swaps,
        IERC20[] calldata tokens,
        FundManagement calldata funds,
        SwapKind kind
    ) external {
        require(msg.sender == address(this), "Caller is not the Vault");
        int256[] memory tokenDeltas = _swapWithPools(swaps, tokens, funds, kind);
        revert(string(abi.encode(tokenDeltas)));
    }
}
