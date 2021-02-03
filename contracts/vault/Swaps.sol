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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

import "../lib/math/Math.sol";
import "../lib/helpers/EnumerableMap.sol";
import "../lib/helpers/ReentrancyGuard.sol";

import "./PoolRegistry.sol";
import "./interfaces/IPoolSwapStructs.sol";
import "./interfaces/IGeneralPool.sol";
import "./interfaces/IMinimalSwapInfoPool.sol";
import "./interfaces/ISwapValidator.sol";
import "./balances/BalanceAllocation.sol";

abstract contract Swaps is ReentrancyGuard, PoolRegistry {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableMap for EnumerableMap.IERC20ToBytes32Map;

    using Math for int256;
    using SafeCast for uint256;
    using BalanceAllocation for bytes32;

    // Despite the external API having two separate functions for given in and given out, internally their are handled
    // together to avoid unnecessary code duplication. This enum indicates which kind of swap we're processing.
    enum SwapKind { GIVEN_IN, GIVEN_OUT }

    // This struct is identical in layout to SwapIn and SwapOut, except the 'amountIn/Out' field is named 'amount'.
    struct InternalSwap {
        bytes32 poolId;
        uint256 tokenInIndex;
        uint256 tokenOutIndex;
        uint256 amount;
        bytes userData;
    }

    event Swap(
        bytes32 indexed poolId,
        IERC20 indexed tokenIn,
        IERC20 indexed tokenOut,
        uint256 tokensIn,
        uint256 tokensOut
    );

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

    function _toInternalSwap(SwapIn[] memory swapsIn)
        private
        pure
        returns (InternalSwap[] memory internalSwapRequests)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            internalSwapRequests := swapsIn
        }
    }

    function _toInternalSwap(SwapOut[] memory swapsOut)
        private
        pure
        returns (InternalSwap[] memory internalSwapRequests)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            internalSwapRequests := swapsOut
        }
    }

    // This struct is identical in layout to SwapRequestGivenIn and SwapRequestGivenOut from IPoolSwapStructs, except
    // the 'amountIn/Out' is named 'amount'.
    struct InternalSwapRequest {
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint256 amount;
        bytes32 poolId;
        uint256 latestBlockNumberUsed;
        address from;
        address to;
        bytes userData;
    }

    // We use inline assembly to cast from the internal struct type to the external ones, depending on the swap kind.
    // This doesn't trigger any conversions or runtime analysis: it is just coercing the type system to reinterpret the
    // data as another type.

    function _toSwapRequestGivenIn(InternalSwapRequest memory internalSwapRequest)
        private
        pure
        returns (IPoolSwapStructs.SwapRequestGivenIn memory swapRequestGivenIn)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            swapRequestGivenIn := internalSwapRequest
        }
    }

    function _toSwapRequestGivenOut(InternalSwapRequest memory internalSwapRequest)
        private
        pure
        returns (IPoolSwapStructs.SwapRequestGivenOut memory swapRequestGivenOut)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            swapRequestGivenOut := internalSwapRequest
        }
    }

    /**
     * @dev Implements both `batchSwapGivenIn` and `batchSwapGivenIn` (minus the validator call), depending on the
     * `kind` value.
     */
    function _batchSwap(
        InternalSwap[] memory swaps,
        IERC20[] memory tokens,
        FundManagement memory funds,
        SwapKind kind
    ) private nonReentrant returns (int256[] memory) {
        // Perform the swaps, updating the Pool balances and computing the net Vault token deltas
        int256[] memory tokenDeltas = _swapWithPools(swaps, tokens, funds, kind);

        // Process token deltas, by either transferring tokens from the sender (for positive deltas) or to the recipient
        // (for negative deltas).
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            int256 delta = tokenDeltas[i];

            // Ignore zeroed deltas
            if (delta > 0) {
                uint256 toReceive = uint256(delta);
                if (funds.fromInternalBalance) {
                    uint256 currentInternalBalance = _getInternalBalance(msg.sender, token);
                    uint256 toWithdraw = Math.min(currentInternalBalance, toReceive);
                    _setInternalBalance(msg.sender, token, currentInternalBalance - toWithdraw);
                    toReceive -= toWithdraw;
                }
                if (toReceive > 0) {
                    token.safeTransferFrom(msg.sender, address(this), toReceive);
                }
            } else if (delta < 0) {
                uint256 toSend = uint256(-delta);

                if (funds.toInternalBalance) {
                    // Deposit tokens to the recipient's Internal Balance - the Vault's balance doesn't change
                    _increaseInternalBalance(funds.recipient, token, toSend);
                } else {
                    // Transfer the tokens to the recipient - note protocol withdraw fees are not charged by this
                    token.safeTransfer(funds.recipient, toSend);
                }
            }
        }

        return tokenDeltas;
    }

    // For `_batchSwap` to handle both given in and given out swaps, it internally tracks the 'given' amount (supplied
    // by the caller), and the 'calculated' one (returned by the Pool in response to the swap request).

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
     * @dev Given the two swap tokens and the swap kind, returns which one is the 'calculated' token (the one for
     * which the amount is calculated by the Pool).
     */
    function _tokenCalculated(
        SwapKind kind,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) private pure returns (IERC20) {
        return kind == SwapKind.GIVEN_IN ? tokenOut : tokenIn;
    }

    /**
     * @dev Returns an ordered pair (amountIn, amountOut) given the amounts given and calculated and the swap kind.
     */
    function _getAmounts(
        SwapKind kind,
        uint256 amountGiven,
        uint256 amountCalculated
    ) private pure returns (uint256 amountIn, uint256 amountOut) {
        if (kind == SwapKind.GIVEN_IN) {
            (amountIn, amountOut) = (amountGiven, amountCalculated);
        } else {
            (amountIn, amountOut) = (amountCalculated, amountGiven);
        }
    }

    // This struct helps implement the multihop logic: if the amount given is not provided for a swap, then the given
    // token must match the previous calculated token, and the previous calculated amount becomes the new given amount.
    // For swaps of kind given in, amount in and token in are given, while amount out and token out are calculated.
    // For swaps of kind given out, amount out and token out are given, while amount in and token are calculated.
    struct LastSwapData {
        IERC20 tokenCalculated;
        uint256 amountCalculated;
    }

    /**
     * @dev Performs all `swaps`, calling swap callbacks on the Pools and updating their balances. Does not cause any
     * transfer of tokens - it instead returns the net Vault token deltas: positive if the Vault should receive tokens,
     * and negative if it should send them.
     */
    function _swapWithPools(
        InternalSwap[] memory swaps,
        IERC20[] memory tokens,
        FundManagement memory funds,
        SwapKind kind
    ) private returns (int256[] memory tokenDeltas) {
        tokenDeltas = new int256[](tokens.length);

        // Passed to _swapWithPool, which stores data about the previous swap here to implement multihop logic across
        // swaps.
        LastSwapData memory previous;

        // This variable could be declared inside the loop, but that causes the compiler to allocate memory on each loop
        // iteration, increasing gas costs.
        InternalSwap memory swap;
        for (uint256 i = 0; i < swaps.length; ++i) {
            swap = swaps[i];
            require(swap.tokenInIndex < tokens.length && swap.tokenOutIndex < tokens.length, "ERR_INDEX_OUT_OF_BOUNDS");

            IERC20 tokenIn = tokens[swap.tokenInIndex];
            IERC20 tokenOut = tokens[swap.tokenOutIndex];
            require(tokenIn != tokenOut, "Swap for same token");

            if (swap.amount == 0) {
                if (swaps.length > 1) {
                    // Sentinel value for multihop logic
                    // When the amount given is not provided, we use the calculated amount for the previous swap,
                    // assuming the current swap's given token is the previous' calculated token.
                    // This makes it possible to e.g. swap a given amount of token A for token B,
                    // and then use the resulting token B amount to swap for token C.
                    bool usingPreviousToken = previous.tokenCalculated == _tokenGiven(kind, tokenIn, tokenOut);
                    require(usingPreviousToken, "Misconstructed multihop swap");
                    swap.amount = previous.amountCalculated;
                } else {
                    revert("Unknown amount in on first swap");
                }
            }

            (uint256 amountIn, uint256 amountOut) = _swapWithPool(
                tokenIn,
                tokenOut,
                swap,
                msg.sender,
                funds.recipient,
                previous,
                kind
            );

            // Accumulate Vault deltas across swaps
            tokenDeltas[swap.tokenInIndex] = tokenDeltas[swap.tokenInIndex].add(amountIn.toInt256());
            tokenDeltas[swap.tokenOutIndex] = tokenDeltas[swap.tokenOutIndex].sub(amountOut.toInt256());

            emit Swap(swap.poolId, tokenIn, tokenOut, amountIn, amountOut);
        }

        return tokenDeltas;
    }

    /**
     * @dev Performs `swap`, updating the Pool balance. Returns a pair with the amount of tokens going into and out of
     * the Vault as a result of this swap.
     *
     * This function expects to be called with the `previous` swap struct, which will be updated internally to
     * implement multihop logic.
     */
    function _swapWithPool(
        IERC20 tokenIn,
        IERC20 tokenOut,
        InternalSwap memory swap,
        address from,
        address to,
        LastSwapData memory previous,
        SwapKind kind
    ) private returns (uint256 amountIn, uint256 amountOut) {
        InternalSwapRequest memory swapRequest = InternalSwapRequest({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amount: swap.amount,
            poolId: swap.poolId,
            latestBlockNumberUsed: 0, // will be updated later on based on the pool specialization
            from: from,
            to: to,
            userData: swap.userData
        });

        // Get the calculated amount from the Pool and update its balances
        uint256 amountCalculated = _processSwapRequest(swapRequest, kind);

        // Store swap information for next pass
        previous.tokenCalculated = _tokenCalculated(kind, tokenIn, tokenOut);
        previous.amountCalculated = amountCalculated;

        (amountIn, amountOut) = _getAmounts(kind, swap.amount, amountCalculated);
    }

    /**
     * @dev Calls the swap request callback on the Pool and updates its balances as a result of the swap being executed.
     * The interface used for the call will depend on the Pool's specialization setting.
     *
     * Returns the token amount calculated by the Pool.
     */
    function _processSwapRequest(InternalSwapRequest memory swapRequest, SwapKind kind) private returns (uint256) {
        address pool = _getPoolAddress(swapRequest.poolId);
        PoolSpecialization specialization = _getPoolSpecialization(swapRequest.poolId);

        if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            return _processMinimalSwapInfoPoolSwapRequest(swapRequest, IMinimalSwapInfoPool(pool), kind);
        } else if (specialization == PoolSpecialization.TWO_TOKEN) {
            return _processTwoTokenPoolSwapRequest(swapRequest, IMinimalSwapInfoPool(pool), kind);
        } else {
            return _processGeneralPoolSwapRequest(swapRequest, IGeneralPool(pool), kind);
        }
    }

    function _processTwoTokenPoolSwapRequest(
        InternalSwapRequest memory internalSwapRequest,
        IMinimalSwapInfoPool pool,
        SwapKind kind
    ) private returns (uint256 amountCalculated) {
        // Due to gas efficiency reasons, this function uses low-level knowledge of how Two Token Pool balances are
        // stored internally, instead of using getters and setters for all operations.

        (
            bytes32 tokenABalance,
            bytes32 tokenBBalance,
            TwoTokenSharedBalances storage poolSharedBalances
        ) = _getTwoTokenPoolSharedBalances(
            internalSwapRequest.poolId,
            internalSwapRequest.tokenIn,
            internalSwapRequest.tokenOut
        );

        // We have the two Pool balances, but we don't know which one is the token in and which one is the token out.
        bytes32 tokenInBalance;
        bytes32 tokenOutBalance;

        // In Two Token Pools, token A has a smaller address than token B
        if (internalSwapRequest.tokenIn < internalSwapRequest.tokenOut) {
            // in is A, out is B
            tokenInBalance = tokenABalance;
            tokenOutBalance = tokenBBalance;
        } else {
            // in is B, out is A
            tokenOutBalance = tokenABalance;
            tokenInBalance = tokenBBalance;
        }

        // Perform the swap request and compute the new balances for token in and token out after the swap
        (tokenInBalance, tokenOutBalance, amountCalculated) = _processMinimalSwapRequest(
            internalSwapRequest,
            pool,
            kind,
            tokenInBalance,
            tokenOutBalance
        );

        // We check the token ordering again to create the new shared cash packed struct
        poolSharedBalances.sharedCash = internalSwapRequest.tokenIn < internalSwapRequest.tokenOut
            ? BalanceAllocation.toSharedCash(tokenInBalance, tokenOutBalance) // in is A, out is B
            : BalanceAllocation.toSharedCash(tokenOutBalance, tokenInBalance); // in is B, out is A
    }

    function _processMinimalSwapInfoPoolSwapRequest(
        InternalSwapRequest memory internalSwapRequest,
        IMinimalSwapInfoPool pool,
        SwapKind kind
    ) private returns (uint256 amountCalculated) {
        bytes32 tokenInBalance = _getMinimalSwapInfoPoolBalance(
            internalSwapRequest.poolId,
            internalSwapRequest.tokenIn
        );
        bytes32 tokenOutBalance = _getMinimalSwapInfoPoolBalance(
            internalSwapRequest.poolId,
            internalSwapRequest.tokenOut
        );

        // Perform the swap request and compute the new balances for token in and token out after the swap
        (tokenInBalance, tokenOutBalance, amountCalculated) = _processMinimalSwapRequest(
            internalSwapRequest,
            pool,
            kind,
            tokenInBalance,
            tokenOutBalance
        );

        _minimalSwapInfoPoolsBalances[internalSwapRequest.poolId][internalSwapRequest.tokenIn] = tokenInBalance;
        _minimalSwapInfoPoolsBalances[internalSwapRequest.poolId][internalSwapRequest.tokenOut] = tokenOutBalance;
    }

    function _processMinimalSwapRequest(
        InternalSwapRequest memory internalSwapRequest,
        IMinimalSwapInfoPool pool,
        SwapKind kind,
        bytes32 tokenInBalance,
        bytes32 tokenOutBalance
    )
        internal
        returns (
            bytes32 newTokenInBalance,
            bytes32 newTokenOutBalance,
            uint256 amountCalculated
        )
    {
        uint256 tokenInTotal = tokenInBalance.total();
        uint256 tokenOutTotal = tokenOutBalance.total();
        internalSwapRequest.latestBlockNumberUsed = Math.max(
            tokenInBalance.blockNumber(),
            tokenOutBalance.blockNumber()
        );

        // Perform the swap request callback and compute the new balances for token in and token out after the swap
        if (kind == SwapKind.GIVEN_IN) {
            IPoolSwapStructs.SwapRequestGivenIn memory swapIn = _toSwapRequestGivenIn(internalSwapRequest);
            uint256 amountOut = pool.onSwapGivenIn(swapIn, tokenInTotal, tokenOutTotal);

            newTokenInBalance = tokenInBalance.increaseCash(internalSwapRequest.amount);
            newTokenOutBalance = tokenOutBalance.decreaseCash(amountOut);
            amountCalculated = amountOut;
        } else {
            IPoolSwapStructs.SwapRequestGivenOut memory swapOut = _toSwapRequestGivenOut(internalSwapRequest);
            uint256 amountIn = pool.onSwapGivenOut(swapOut, tokenInTotal, tokenOutTotal);

            newTokenInBalance = tokenInBalance.increaseCash(amountIn);
            newTokenOutBalance = tokenOutBalance.decreaseCash(internalSwapRequest.amount);
            amountCalculated = amountIn;
        }
    }

    function _processGeneralPoolSwapRequest(
        InternalSwapRequest memory internalSwapRequest,
        IGeneralPool pool,
        SwapKind kind
    ) private returns (uint256 amountCalculated) {
        bytes32 tokenInBalance;
        bytes32 tokenOutBalance;

        EnumerableMap.IERC20ToBytes32Map storage poolBalances = _generalPoolsBalances[internalSwapRequest.poolId];
        uint256 indexIn = poolBalances.indexOf(internalSwapRequest.tokenIn, "ERR_TOKEN_NOT_REGISTERED");
        uint256 indexOut = poolBalances.indexOf(internalSwapRequest.tokenOut, "ERR_TOKEN_NOT_REGISTERED");

        uint256 tokenAmount = poolBalances.length();
        uint256[] memory currentBalances = new uint256[](tokenAmount);

        for (uint256 i = 0; i < tokenAmount; i++) {
            // Because the iteration is bounded by `tokenAmount` and no tokens are registered or unregistered here, we
            // can use `unchecked_valueAt` as we know `i` is a valid token index, saving storage reads.
            bytes32 balance = poolBalances.unchecked_valueAt(i);

            currentBalances[i] = balance.total();
            internalSwapRequest.latestBlockNumberUsed = Math.max(
                internalSwapRequest.latestBlockNumberUsed,
                balance.blockNumber()
            );

            if (i == indexIn) {
                tokenInBalance = balance;
            } else if (i == indexOut) {
                tokenOutBalance = balance;
            }
        }

        // Perform the swap request callback and compute the new balances for token in and token out after the swap
        if (kind == SwapKind.GIVEN_IN) {
            IPoolSwapStructs.SwapRequestGivenIn memory swapRequestIn = _toSwapRequestGivenIn(internalSwapRequest);
            uint256 amountOut = pool.onSwapGivenIn(swapRequestIn, currentBalances, indexIn, indexOut);

            amountCalculated = amountOut;
            tokenInBalance = tokenInBalance.increaseCash(internalSwapRequest.amount);
            tokenOutBalance = tokenOutBalance.decreaseCash(amountOut);
        } else {
            IPoolSwapStructs.SwapRequestGivenOut memory swapRequestOut = _toSwapRequestGivenOut(internalSwapRequest);
            uint256 amountIn = pool.onSwapGivenOut(swapRequestOut, currentBalances, indexIn, indexOut);

            amountCalculated = amountIn;
            tokenInBalance = tokenInBalance.increaseCash(amountIn);
            tokenOutBalance = tokenOutBalance.decreaseCash(internalSwapRequest.amount);
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
        InternalSwap[] memory swaps,
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
     * It executes the Pool interaction part of a batch swap, calling swap request callbacks on pools and computing,
     * the Vault deltas, but without performing any token transfers. It then reverts unconditionally, returning the
     * Vault deltas array as the revert data.
     *
     * This enables an accurate implementation of queryBatchSwapGivenIn and queryBatchSwapGivenOut, since the array
     * 'returned' by this function is the result of the exact same computation a swap would perform, including the Pool
     * calls.
     */
    function queryBatchSwapHelper(
        InternalSwap[] memory swaps,
        IERC20[] calldata tokens,
        FundManagement calldata funds,
        SwapKind kind
    ) external {
        require(msg.sender == address(this), "Caller is not the Vault");
        int256[] memory tokenDeltas = _swapWithPools(swaps, tokens, funds, kind);
        revert(string(abi.encode(tokenDeltas)));
    }
}
