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

import "../BaseMinimalSwapInfoPool.sol";

import "./WeightedMath.sol";
import "./WeightedPoolUserDataHelpers.sol";

// This contract relies on tons of immutable state variables to
// perform efficient lookup, without resorting to storage reads.
// solhint-disable max-states-count

contract WeightedPool is BaseMinimalSwapInfoPool, WeightedMath {
    using FixedPoint for uint256;
    using WeightedPoolUserDataHelpers for bytes;

    // The protocol fees will be always charged using the token associated to the max weight in the pool.
    // Since these Pools will register tokens only once, we can assume this index will be constant.
    uint256 private immutable _maxWeightTokenIndex;

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
    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, EXACT_BPT_IN_FOR_TOKENS_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT }

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFee,
        uint256 emergencyPeriod,
        uint256 emergencyPeriodCheckExtension
    ) BaseMinimalSwapInfoPool(vault, name, symbol, tokens, swapFee, emergencyPeriod, emergencyPeriodCheckExtension) {
        InputHelpers.ensureInputLengthMatch(weights.length, tokens.length);

        // Check valid weights and compute normalized weights
        uint256 sumWeights = 0;
        for (uint8 i = 0; i < weights.length; i++) {
            sumWeights = sumWeights.add(weights[i]);
        }

        uint256 maxWeightTokenIndex = 0;
        uint256 maxNormalizedWeight = 0;
        uint256[] memory normalizedWeights = new uint256[](weights.length);

        for (uint8 i = 0; i < normalizedWeights.length; i++) {
            uint256 normalizedWeight = weights[i].div(sumWeights);
            _require(normalizedWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);
            normalizedWeights[i] = normalizedWeight;

            if (normalizedWeight > maxNormalizedWeight) {
                maxWeightTokenIndex = i;
                maxNormalizedWeight = normalizedWeight;
            }
        }

        _maxWeightTokenIndex = maxWeightTokenIndex;
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

    function _normalizedWeight(IERC20 token) internal view virtual returns (uint256) {
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

    function _normalizedWeights() internal view virtual returns (uint256[] memory) {
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
        return WeightedMath._calculateInvariant(normalizedWeights, balances);
    }

    function getNormalizedWeights() external view returns (uint256[] memory) {
        return _normalizedWeights();
    }

    // Base Pool handlers

    // Swap

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view virtual override noEmergencyPeriod returns (uint256) {
        _require(swapRequest.amount <= currentBalanceTokenIn.mul(_MAX_IN_RATIO), Errors.ERR_MAX_IN_RATIO);

        return
            WeightedMath._calcOutGivenIn(
                currentBalanceTokenIn,
                _normalizedWeight(swapRequest.tokenIn),
                currentBalanceTokenOut,
                _normalizedWeight(swapRequest.tokenOut),
                swapRequest.amount
            );
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256 currentBalanceTokenIn,
        uint256 currentBalanceTokenOut
    ) internal view virtual override noEmergencyPeriod returns (uint256) {
        _require(swapRequest.amount <= currentBalanceTokenOut.mul(_MAX_OUT_RATIO), Errors.ERR_MAX_OUT_RATIO);

        return
            WeightedMath._calcInGivenOut(
                currentBalanceTokenIn,
                _normalizedWeight(swapRequest.tokenIn),
                currentBalanceTokenOut,
                _normalizedWeight(swapRequest.tokenOut),
                swapRequest.amount
            );
    }

    // Initialize

    function _onInitializePool(
        bytes32,
        address,
        address,
        bytes memory userData
    ) internal virtual override noEmergencyPeriod returns (uint256, uint256[] memory) {
        WeightedPool.JoinKind kind = userData.joinKind();
        _require(kind == WeightedPool.JoinKind.INIT, Errors.UNINITIALIZED);

        uint256[] memory amountsIn = userData.initialAmountsIn();
        _require(amountsIn.length == _totalTokens, Errors.ERR_AMOUNTS_IN_LENGTH);
        _upscaleArray(amountsIn, _scalingFactors());

        uint256[] memory normalizedWeights = _normalizedWeights();

        uint256 invariantAfterJoin = WeightedMath._calculateInvariant(normalizedWeights, amountsIn);

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
        virtual
        override
        noEmergencyPeriod
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
        uint256[] memory normalizedWeights = _normalizedWeights();

        // Due protocol swap fees are computed by measuring the growth of the invariant from the previous join or exit
        // event and now - the invariant's growth is due exclusively to swap fees.
        uint256 invariantBeforeJoin = WeightedMath._calculateInvariant(normalizedWeights, currentBalances);

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
        (uint256[] memory amountsIn, uint256 minBPTAmountIn) = userData.exactTokensInForBptOut();
        _require(amountsIn.length == _totalTokens, Errors.ERR_AMOUNTS_IN_LENGTH);
        _upscaleArray(amountsIn, _scalingFactors());

        uint256 bptAmountOut = WeightedMath._calcBptOutGivenExactTokensIn(
            currentBalances,
            normalizedWeights,
            amountsIn,
            totalSupply(),
            _swapFee
        );

        _require(bptAmountOut >= minBPTAmountIn, Errors.BPT_OUT_MIN_AMOUNT);

        return (bptAmountOut, amountsIn);
    }

    function _joinTokenInForExactBPTOut(
        uint256[] memory currentBalances,
        uint256[] memory normalizedWeights,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        (uint256 bptAmountOut, uint256 tokenIndex) = userData.tokenInForExactBptOut();

        uint256 bptTotalSupply = totalSupply();

        //Verifies that invariant ratio is not greater than max
        uint256 invariantRatio = bptTotalSupply.add(bptAmountOut).div(bptTotalSupply);
        _require(invariantRatio <= _MAX_INVARIANT_RATIO, Errors.MAX_OUT_BPT_FOR_TOKEN_IN);

        uint256[] memory amountsIn = new uint256[](_totalTokens);
        amountsIn[tokenIndex] = WeightedMath._calcTokenInGivenExactBptOut(
            currentBalances[tokenIndex],
            normalizedWeights[tokenIndex],
            bptAmountOut,
            bptTotalSupply,
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
        virtual
        override
        returns (
            uint256 bptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
        uint256[] memory normalizedWeights = _normalizedWeights();

        //If emergency period is active, protocol fees are not charged to avoid any extra calculation.
        if (_isEmergencyPeriodInactive()) {
            // Due protocol swap fees are computed by measuring the growth of the invariant from the previous
            // join or exit event and now - the invariant's growth is due exclusively to swap fees.
            uint256 invariantBeforeExit = WeightedMath._calculateInvariant(normalizedWeights, currentBalances);
            dueProtocolFeeAmounts = _getDueProtocolFeeAmounts(
                currentBalances,
                normalizedWeights,
                _lastInvariant,
                invariantBeforeExit,
                protocolSwapFeePercentage
            );

            // Update current balances by subtracting the protocol due fee amounts
            _subtractToCurrentBalances(currentBalances, dueProtocolFeeAmounts);
        } else {
            dueProtocolFeeAmounts = new uint256[](_totalTokens);
        }

        (bptAmountIn, amountsOut) = _doExit(currentBalances, normalizedWeights, userData);

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
            return _exitExactBPTInForTokenOut(normalizedWeights, currentBalances, userData);
        } else if (kind == ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {
            return _exitExactBPTInForTokensOut(currentBalances, userData);
        } else if (kind == ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT) {
            return _exitBPTInForExactTokensOut(normalizedWeights, currentBalances, userData);
        } else {
            revert("UNHANDLED_EXIT_KIND");
        }
    }

    function _exitExactBPTInForTokenOut(
        uint256[] memory normalizedWeights,
        uint256[] memory currentBalances,
        bytes memory userData
    ) private view noEmergencyPeriod returns (uint256, uint256[] memory) {
        (uint256 bptAmountIn, uint256 tokenIndex) = userData.exactBptInForTokenOut();
        _require(tokenIndex < _totalTokens, Errors.OUT_OF_BOUNDS);

        uint256 bptTotalSupply = totalSupply();

        // Verifies that invariant ratio is not lower than min
        uint256 invariantRatio = bptTotalSupply.sub(bptAmountIn).div(bptTotalSupply);
        _require(invariantRatio >= _MIN_INVARIANT_RATIO, Errors.MIN_BPT_IN_FOR_TOKEN_OUT);

        // We exit in a single token, so we initialize amountsOut with zeros
        uint256[] memory amountsOut = new uint256[](_totalTokens);

        // And then assign the result to the selected token
        amountsOut[tokenIndex] = WeightedMath._calcTokenOutGivenExactBptIn(
            currentBalances[tokenIndex],
            normalizedWeights[tokenIndex],
            bptAmountIn,
            totalSupply(),
            _swapFee
        );

        return (bptAmountIn, amountsOut);
    }

    /**
     * @dev Note we are not tagging this function with `noEmergencyPeriod` to allow users exit in a proportional
     * manner in case there is an emergency in the pool. This operation should never be restricted.
     */
    function _exitExactBPTInForTokensOut(uint256[] memory currentBalances, bytes memory userData)
        private
        view
        returns (uint256, uint256[] memory)
    {
        uint256 bptAmountIn = userData.exactBptInForTokensOut();

        uint256[] memory amountsOut = WeightedMath._calcTokensOutGivenExactBptIn(
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
    ) private view noEmergencyPeriod returns (uint256, uint256[] memory) {
        (uint256[] memory amountsOut, uint256 maxBPTAmountIn) = userData.bptInForExactTokensOut();
        InputHelpers.ensureInputLengthMatch(amountsOut.length, _totalTokens);
        _upscaleArray(amountsOut, _scalingFactors());

        uint256 bptAmountIn = WeightedMath._calcBptInGivenExactTokensOut(
            currentBalances,
            normalizedWeights,
            amountsOut,
            totalSupply(),
            _swapFee
        );
        _require(bptAmountIn <= maxBPTAmountIn, Errors.BPT_IN_MAX_AMOUNT);

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
        // Initialize with zeros
        uint256[] memory dueProtocolFeeAmounts = new uint256[](_totalTokens);

        // Verifies that invariant ratio is not lower than min.
        // If lower than min, protocol fees will charge up to the min ratio allowed.
        uint256 invariantRatio = previousInvariant.divUp(currentInvariant);
        if (invariantRatio <= _MIN_INVARIANT_RATIO) {
            currentInvariant = previousInvariant.divUp(_MIN_INVARIANT_RATIO);
        }

        // The protocol swap fee are always paid using the token with the largest weight in the pool.
        // As this is then token that will probably have the largest balance in the pool, we can
        // make sure this process won't unbalance the pool in a considerable way.
        dueProtocolFeeAmounts[_maxWeightTokenIndex] = WeightedMath._calcDueTokenProtocolSwapFee(
            currentBalances[_maxWeightTokenIndex],
            normalizedWeights[_maxWeightTokenIndex],
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

        return WeightedMath._calculateInvariant(normalizedWeights, currentBalances);
    }

    function _invariantAfterExit(
        uint256[] memory currentBalances,
        uint256[] memory amountsOut,
        uint256[] memory normalizedWeights
    ) private view returns (uint256) {
        _subtractToCurrentBalances(currentBalances, amountsOut);
        return WeightedMath._calculateInvariant(normalizedWeights, currentBalances);
    }

    function _subtractToCurrentBalances(uint256[] memory currentBalances, uint256[] memory amounts) private view {
        for (uint256 i = 0; i < _totalTokens; ++i) {
            currentBalances[i] = currentBalances[i].sub(amounts[i]);
        }
    }

    // This function returns the appreciation of one BPT relative to the
    // underlying tokens. This starts at 1 when the pool is initialized and grows over time
    // It's the equivalent to Curve's get_virtual_price() function
    function getRate() public view override returns (uint256) {
        (, uint256[] memory balances) = _vault.getPoolTokens(_poolId);
        return
            Math.mul(WeightedMath._calculateInvariant(_normalizedWeights(), balances), _totalTokens).div(totalSupply());
    }
}
