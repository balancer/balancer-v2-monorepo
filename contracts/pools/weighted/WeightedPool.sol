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

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "../../lib/math/FixedPoint.sol";
import "../../lib/helpers/InputHelpers.sol";
import "../../lib/helpers/UnsafeRandom.sol";

import "../BaseMinimalSwapInfoPool.sol";

import "./WeightedMath.sol";
import "./WeightedPoolUserDataHelpers.sol";

// This contract relies on tons of immutable state variables to
// perform efficient lookup, without resorting to storage reads.
// solhint-disable max-states-count

contract WeightedPool is BaseMinimalSwapInfoPool, WeightedMath {
    using FixedPoint for uint256;
    using WeightedPoolUserDataHelpers for bytes;

    // TODO: link info about these limits once they are studied and documented
    uint256 private constant _MIN_WEIGHT = 100;
    uint256 private constant _MAX_WEIGHT = 5000 * (10**18);

    uint256 private immutable _normalizedWeight0;
    uint256 private immutable _normalizedWeight1;
    uint256 private immutable _normalizedWeight2;
    uint256 private immutable _normalizedWeight3;
    uint256 private immutable _normalizedWeight4;
    uint256 private immutable _normalizedWeight5;
    uint256 private immutable _normalizedWeight6;
    uint256 private immutable _normalizedWeight7;
    uint256 private immutable _normalizedWeight8;
    uint256 private immutable _normalizedWeight9;
    uint256 private immutable _normalizedWeight10;
    uint256 private immutable _normalizedWeight11;
    uint256 private immutable _normalizedWeight12;
    uint256 private immutable _normalizedWeight13;
    uint256 private immutable _normalizedWeight14;
    uint256 private immutable _normalizedWeight15;

    uint256 private _lastInvariant;

    enum JoinKind { INIT, EXACT_TOKENS_IN_FOR_BPT_OUT, TOKEN_IN_FOR_EXACT_BPT_OUT }
    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, EXACT_BPT_IN_FOR_ALL_TOKENS_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT }

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFee
    ) BaseMinimalSwapInfoPool(vault, name, symbol, tokens, swapFee) {
        InputHelpers.ensureInputLengthMatch(weights.length, tokens.length);

        // Check valid weights and compute normalized weights
        uint256 sumWeights = 0;
        for (uint8 i = 0; i < weights.length; i++) {
            require(weights[i] >= _MIN_WEIGHT, "MIN_WEIGHT");
            require(weights[i] <= _MAX_WEIGHT, "MAX_WEIGHT");
            sumWeights = sumWeights.add(weights[i]);
        }

        uint256[] memory normalizedWeights = new uint256[](weights.length);
        for (uint8 i = 0; i < normalizedWeights.length; i++) {
            normalizedWeights[i] = weights[i].div(sumWeights);
        }

        _normalizedWeight0 = weights.length > 0 ? normalizedWeights[0] : 0;
        _normalizedWeight1 = weights.length > 1 ? normalizedWeights[1] : 0;
        _normalizedWeight2 = weights.length > 2 ? normalizedWeights[2] : 0;
        _normalizedWeight3 = weights.length > 3 ? normalizedWeights[3] : 0;
        _normalizedWeight4 = weights.length > 4 ? normalizedWeights[4] : 0;
        _normalizedWeight5 = weights.length > 5 ? normalizedWeights[5] : 0;
        _normalizedWeight6 = weights.length > 6 ? normalizedWeights[6] : 0;
        _normalizedWeight7 = weights.length > 7 ? normalizedWeights[7] : 0;
        _normalizedWeight8 = weights.length > 8 ? normalizedWeights[8] : 0;
        _normalizedWeight9 = weights.length > 9 ? normalizedWeights[9] : 0;
        _normalizedWeight10 = weights.length > 10 ? normalizedWeights[10] : 0;
        _normalizedWeight11 = weights.length > 11 ? normalizedWeights[11] : 0;
        _normalizedWeight12 = weights.length > 12 ? normalizedWeights[12] : 0;
        _normalizedWeight13 = weights.length > 13 ? normalizedWeights[13] : 0;
        _normalizedWeight14 = weights.length > 14 ? normalizedWeights[14] : 0;
        _normalizedWeight15 = weights.length > 15 ? normalizedWeights[15] : 0;
    }

    function _normalizedWeight(IERC20 token) internal view returns (uint256) {
        // prettier-ignore
        if (token == _token0) { return _normalizedWeight0; }
        else if (token == _token1) { return _normalizedWeight1; }
        else if (token == _token2) { return _normalizedWeight2; }
        else if (token == _token3) { return _normalizedWeight3; }
        else if (token == _token4) { return _normalizedWeight4; }
        else if (token == _token5) { return _normalizedWeight5; }
        else if (token == _token6) { return _normalizedWeight6; }
        else if (token == _token7) { return _normalizedWeight7; }
        else if (token == _token8) { return _normalizedWeight8; }
        else if (token == _token9) { return _normalizedWeight9; }
        else if (token == _token10) { return _normalizedWeight10; }
        else if (token == _token11) { return _normalizedWeight11; }
        else if (token == _token12) { return _normalizedWeight12; }
        else if (token == _token13) { return _normalizedWeight13; }
        else if (token == _token14) { return _normalizedWeight14; }
        else if (token == _token15) { return _normalizedWeight15; }
        else {
            revert("INVALID_TOKEN");
        }
    }

    function _normalizedWeights() internal view returns (uint256[] memory) {
        uint256[] memory normalizedWeights = new uint256[](_totalTokens);

        // prettier-ignore
        {
            if (_totalTokens > 0) { normalizedWeights[0] = _normalizedWeight0; } else { return normalizedWeights; }
            if (_totalTokens > 1) { normalizedWeights[1] = _normalizedWeight1; } else { return normalizedWeights; }
            if (_totalTokens > 2) { normalizedWeights[2] = _normalizedWeight2; } else { return normalizedWeights; }
            if (_totalTokens > 3) { normalizedWeights[3] = _normalizedWeight3; } else { return normalizedWeights; }
            if (_totalTokens > 4) { normalizedWeights[4] = _normalizedWeight4; } else { return normalizedWeights; }
            if (_totalTokens > 5) { normalizedWeights[5] = _normalizedWeight5; } else { return normalizedWeights; }
            if (_totalTokens > 6) { normalizedWeights[6] = _normalizedWeight6; } else { return normalizedWeights; }
            if (_totalTokens > 7) { normalizedWeights[7] = _normalizedWeight7; } else { return normalizedWeights; }
            if (_totalTokens > 8) { normalizedWeights[8] = _normalizedWeight8; } else { return normalizedWeights; }
            if (_totalTokens > 9) { normalizedWeights[9] = _normalizedWeight9; } else { return normalizedWeights; }
            if (_totalTokens > 10) { normalizedWeights[10] = _normalizedWeight10; } else { return normalizedWeights; }
            if (_totalTokens > 11) { normalizedWeights[11] = _normalizedWeight11; } else { return normalizedWeights; }
            if (_totalTokens > 12) { normalizedWeights[12] = _normalizedWeight12; } else { return normalizedWeights; }
            if (_totalTokens > 13) { normalizedWeights[13] = _normalizedWeight13; } else { return normalizedWeights; }
            if (_totalTokens > 14) { normalizedWeights[14] = _normalizedWeight14; } else { return normalizedWeights; }
            if (_totalTokens > 15) { normalizedWeights[15] = _normalizedWeight15; } else { return normalizedWeights; }
        }

        return normalizedWeights;
    }

    function getLastInvariant() external view returns (uint256) {
        return _lastInvariant;
    }

    function getInvariant() external view returns (uint256) {
        (, uint256[] memory balances) = _vault.getPoolTokens(_poolId);
        uint256[] memory normalizedWeights = _normalizedWeights();
        return WeightedMath._invariant(normalizedWeights, balances);
    }

    function getNormalizedWeights() external view returns (uint256[] memory) {
        return _normalizedWeights();
    }

    // Base Pool handlers

    // Swap

    function _onSwapGivenIn(
        IPoolSwapStructs.SwapRequestGivenIn memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view override returns (uint256) {
        return
            WeightedMath._outGivenIn(
                currentBalanceTokenIn,
                _normalizedWeight(swapRequest.tokenIn),
                currentBalanceTokenOut,
                _normalizedWeight(swapRequest.tokenOut),
                swapRequest.amountIn
            );
    }

    function _onSwapGivenOut(
        IPoolSwapStructs.SwapRequestGivenOut memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view override returns (uint256) {
        return
            WeightedMath._inGivenOut(
                currentBalanceTokenIn,
                _normalizedWeight(swapRequest.tokenIn),
                currentBalanceTokenOut,
                _normalizedWeight(swapRequest.tokenOut),
                swapRequest.amountOut
            );
    }

    // Initialize

    function _onInitializePool(
        bytes32,
        address,
        address,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        WeightedPool.JoinKind kind = userData.joinKind();
        require(kind == WeightedPool.JoinKind.INIT, "UNINITIALIZED");

        uint256[] memory amountsIn = userData.initialAmountsIn();
        require(amountsIn.length == _totalTokens, "ERR_AMOUNTS_IN_LENGTH");
        _upscaleArray(amountsIn, _scalingFactors());

        uint256[] memory normalizedWeights = _normalizedWeights();

        uint256 invariantAfterJoin = WeightedMath._invariant(normalizedWeights, amountsIn);

        uint256 bptAmountOut = Math.mul(invariantAfterJoin, _totalTokens);

        _lastInvariant = invariantAfterJoin;

        return (bptAmountOut, amountsIn);
    }

    // Join

    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory currentBalances,
        uint256,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        internal
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        uint256[] memory normalizedWeights = _normalizedWeights();

        // Due protocol swap fees are computed by measuring the growth of the invariant from the previous join or exit
        // event and now - the invariant's growth is due exclusively to swap fees.
        uint256 invariantBeforeJoin = WeightedMath._invariant(normalizedWeights, currentBalances);
        uint256[] memory dueProtocolFeeAmounts = _getDueProtocolFeeAmounts(
            currentBalances,
            normalizedWeights,
            _lastInvariant,
            invariantBeforeJoin,
            protocolSwapFeePercentage
        );

        // Update current balances by subtracting the protocol due fee amounts
        _subtractToCurrentBalances(currentBalances, dueProtocolFeeAmounts);
        (uint256 bptAmountOut, uint256[] memory amountsIn) = _doJoin(currentBalances, normalizedWeights, userData);

        // Update the invariant with the balances the Pool will have after the join, in order to compute the due
        // protocol swap fees in future joins and exits.
        _lastInvariant = _invariantAfterJoin(currentBalances, amountsIn, normalizedWeights);

        return (bptAmountOut, amountsIn, dueProtocolFeeAmounts);
    }

    function _doJoin(
        uint256[] memory currentBalances,
        uint256[] memory normalizedWeights,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        JoinKind kind = userData.joinKind();

        if (kind == JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return _joinExactTokensInForBPTOut(currentBalances, normalizedWeights, userData);
        } else if (kind == JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return _joinTokenInForExactBPTOut(currentBalances, normalizedWeights, userData);
        } else {
            revert("UNHANDLED_JOIN_KIND");
        }
    }

    function _joinExactTokensInForBPTOut(
        uint256[] memory currentBalances,
        uint256[] memory normalizedWeights,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        (uint256[] memory amountsIn, uint256 minBPTAmountOut) = userData.exactTokensInForBptOut();
        require(amountsIn.length == _totalTokens, "ERR_AMOUNTS_IN_LENGTH");
        _upscaleArray(amountsIn, _scalingFactors());

        uint256 bptAmountOut = WeightedMath._exactTokensInForBPTOut(
            currentBalances,
            normalizedWeights,
            amountsIn,
            totalSupply(),
            _swapFee
        );

        require(bptAmountOut >= minBPTAmountOut, "BPT_OUT_MIN_AMOUNT");

        return (bptAmountOut, amountsIn);
    }

    function _joinTokenInForExactBPTOut(
        uint256[] memory currentBalances,
        uint256[] memory normalizedWeights,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        (uint256 bptAmountOut, uint256 tokenIndex) = userData.tokenInForExactBptOut();

        uint256[] memory amountsIn = new uint256[](_totalTokens);
        amountsIn[tokenIndex] = WeightedMath._tokenInForExactBPTOut(
            currentBalances[tokenIndex],
            normalizedWeights[tokenIndex],
            bptAmountOut,
            totalSupply(),
            _swapFee
        );

        return (bptAmountOut, amountsIn);
    }

    // Exit

    function _onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory currentBalances,
        uint256,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        internal
        override
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        uint256[] memory normalizedWeights = _normalizedWeights();

        // Due protocol swap fees are computed by measuring the growth of the invariant from the previous join or exit
        // event and now - the invariant's growth is due exclusively to swap fees.
        uint256 invariantBeforeExit = WeightedMath._invariant(normalizedWeights, currentBalances);
        uint256[] memory dueProtocolFeeAmounts = _getDueProtocolFeeAmounts(
            currentBalances,
            normalizedWeights,
            _lastInvariant,
            invariantBeforeExit,
            protocolSwapFeePercentage
        );

        // Update current balances by subtracting the protocol due fee amounts
        _subtractToCurrentBalances(currentBalances, dueProtocolFeeAmounts);
        (uint256 bptAmountIn, uint256[] memory amountsOut) = _doExit(currentBalances, normalizedWeights, userData);

        // Update the invariant with the balances the Pool will have after the exit, in order to compute the due
        // protocol swap fees in future joins and exits.
        _lastInvariant = _invariantAfterExit(currentBalances, amountsOut, normalizedWeights);

        return (bptAmountIn, amountsOut, dueProtocolFeeAmounts);
    }

    function _doExit(
        uint256[] memory currentBalances,
        uint256[] memory normalizedWeights,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        ExitKind kind = userData.exitKind();

        if (kind == ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
            return _exitExactBPTInForOneTokenOut(normalizedWeights, currentBalances, userData);
        } else if (kind == ExitKind.EXACT_BPT_IN_FOR_ALL_TOKENS_OUT) {
            return _exitExactBPTInForAllTokensOut(currentBalances, userData);
        } else if (kind == ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT) {
            return _exitBPTInForExactTokensOut(normalizedWeights, currentBalances, userData);
        } else {
            revert("UNHANDLED_EXIT_KIND");
        }
    }

    function _exitExactBPTInForOneTokenOut(
        uint256[] memory normalizedWeights,
        uint256[] memory currentBalances,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        (uint256 bptAmountIn, uint256 tokenIndex) = userData.exactBptInForOneTokenOut();
        require(tokenIndex < _totalTokens, "OUT_OF_BOUNDS");

        // We exit in a single token, so we initialize amountsOut with zeros
        uint256[] memory amountsOut = new uint256[](_totalTokens);

        // And then assign the result to the selected token
        amountsOut[tokenIndex] = WeightedMath._exactBPTInForTokenOut(
            currentBalances[tokenIndex],
            normalizedWeights[tokenIndex],
            bptAmountIn,
            totalSupply(),
            _swapFee
        );

        return (bptAmountIn, amountsOut);
    }

    function _exitExactBPTInForAllTokensOut(uint256[] memory currentBalances, bytes memory userData)
        private
        view
        returns (uint256, uint256[] memory)
    {
        uint256 bptAmountIn = userData.exactBptInForAllTokensOut();

        uint256[] memory amountsOut = WeightedMath._exactBPTInForAllTokensOut(
            currentBalances,
            bptAmountIn,
            totalSupply()
        );

        return (bptAmountIn, amountsOut);
    }

    function _exitBPTInForExactTokensOut(
        uint256[] memory normalizedWeights,
        uint256[] memory currentBalances,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        (uint256[] memory amountsOut, uint256 maxBPTAmountIn) = userData.bptInForExactTokensOut();
        InputHelpers.ensureInputLengthMatch(amountsOut.length, _totalTokens);
        _upscaleArray(amountsOut, _scalingFactors());

        uint256 bptAmountIn = WeightedMath._bptInForExactTokensOut(
            currentBalances,
            normalizedWeights,
            amountsOut,
            totalSupply(),
            _swapFee
        );
        require(bptAmountIn <= maxBPTAmountIn, "BPT_IN_MAX_AMOUNT");

        return (bptAmountIn, amountsOut);
    }

    // Helpers

    function _getDueProtocolFeeAmounts(
        uint256[] memory currentBalances,
        uint256[] memory normalizedWeights,
        uint256 previousInvariant,
        uint256 currentInvariant,
        uint256 protocolSwapFeePercentage
    ) private view returns (uint256[] memory) {
        // Instead of paying the protocol swap fee in all tokens proportionally, we will pay it in a single one. This
        // will reduce gas costs for single asset joins and exits, as at most only two Pool balances will change (the
        // token joined/exited, and the token in which fees will be paid).

        // The token fees is paid in is chosen pseudo-randomly, with the hope to achieve a uniform distribution across
        // multiple joins and exits. This pseudo-randomness being manipulated is not an issue.
        uint256 chosenTokenIndex = UnsafeRandom.rand(_totalTokens);

        // Initialize with zeros
        uint256[] memory dueProtocolFeeAmounts = new uint256[](_totalTokens);

        // Set the fee to pay in the selected token
        dueProtocolFeeAmounts[chosenTokenIndex] = WeightedMath._calculateDueTokenProtocolSwapFee(
            currentBalances[chosenTokenIndex],
            normalizedWeights[chosenTokenIndex],
            previousInvariant,
            currentInvariant,
            protocolSwapFeePercentage
        );

        return dueProtocolFeeAmounts;
    }

    function _invariantAfterJoin(
        uint256[] memory currentBalances,
        uint256[] memory amountsOut,
        uint256[] memory normalizedWeights
    ) private view returns (uint256) {
        for (uint256 i = 0; i < _totalTokens; ++i) {
            currentBalances[i] = currentBalances[i].add(amountsOut[i]);
        }

        return WeightedMath._invariant(normalizedWeights, currentBalances);
    }

    function _invariantAfterExit(
        uint256[] memory currentBalances,
        uint256[] memory amountsOut,
        uint256[] memory normalizedWeights
    ) private view returns (uint256) {
        _subtractToCurrentBalances(currentBalances, amountsOut);
        return WeightedMath._invariant(normalizedWeights, currentBalances);
    }

    function _subtractToCurrentBalances(uint256[] memory currentBalances, uint256[] memory amounts) private view {
        for (uint256 i = 0; i < _totalTokens; ++i) {
            currentBalances[i] = currentBalances[i].sub(amounts[i]);
        }
    }
}
