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

// This contract relies on tons of immutable state variables to perform efficient lookup, without resorting to storage
// reads. Because immutable arrays are not supported, we instead declare a fixed set of state variables plus total
// count, resulting in a large number of state variables.

contract WeightedPool is BaseMinimalSwapInfoPool, WeightedMath {
    using FixedPoint for uint256;
    using WeightedPoolUserDataHelpers for bytes;

    // The protocol fees will always be charged using the token associated with the max weight in the pool.
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

    uint256 private _lastInvariant;

    enum JoinKind { INIT, EXACT_TOKENS_IN_FOR_BPT_OUT, TOKEN_IN_FOR_EXACT_BPT_OUT }
    enum ExitKind { EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, EXACT_BPT_IN_FOR_TOKENS_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT }

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
        uint256 swapFee,
        uint256 emergencyPeriod,
        uint256 emergencyPeriodCheckExtension,
        address owner
    )
        BaseMinimalSwapInfoPool(
            vault,
            name,
            symbol,
            tokens,
            swapFee,
            emergencyPeriod,
            emergencyPeriodCheckExtension,
            owner
        )
    {
        uint256 numTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(numTokens, normalizedWeights.length);

        // Ensure  each normalized weight is above them minimum and find the token index of the maximum weight
        uint256 normalizedSum = 0;
        uint256 maxWeightTokenIndex = 0;
        uint256 maxNormalizedWeight = 0;
        for (uint8 i = 0; i < numTokens; i++) {
            uint256 normalizedWeight = normalizedWeights[i];
            _require(normalizedWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            normalizedSum = normalizedSum.add(normalizedWeight);
            if (normalizedWeight > maxNormalizedWeight) {
                maxWeightTokenIndex = i;
                maxNormalizedWeight = normalizedWeight;
            }
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _maxWeightTokenIndex = maxWeightTokenIndex;
        _normalizedWeight0 = normalizedWeights.length > 0 ? normalizedWeights[0] : 0;
        _normalizedWeight1 = normalizedWeights.length > 1 ? normalizedWeights[1] : 0;
        _normalizedWeight2 = normalizedWeights.length > 2 ? normalizedWeights[2] : 0;
        _normalizedWeight3 = normalizedWeights.length > 3 ? normalizedWeights[3] : 0;
        _normalizedWeight4 = normalizedWeights.length > 4 ? normalizedWeights[4] : 0;
        _normalizedWeight5 = normalizedWeights.length > 5 ? normalizedWeights[5] : 0;
        _normalizedWeight6 = normalizedWeights.length > 6 ? normalizedWeights[6] : 0;
        _normalizedWeight7 = normalizedWeights.length > 7 ? normalizedWeights[7] : 0;
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
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _normalizedWeights() internal view virtual returns (uint256[] memory) {
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory normalizedWeights = new uint256[](totalTokens);

        // prettier-ignore
        {
            if (totalTokens > 0) { normalizedWeights[0] = _normalizedWeight0; } else { return normalizedWeights; }
            if (totalTokens > 1) { normalizedWeights[1] = _normalizedWeight1; } else { return normalizedWeights; }
            if (totalTokens > 2) { normalizedWeights[2] = _normalizedWeight2; } else { return normalizedWeights; }
            if (totalTokens > 3) { normalizedWeights[3] = _normalizedWeight3; } else { return normalizedWeights; }
            if (totalTokens > 4) { normalizedWeights[4] = _normalizedWeight4; } else { return normalizedWeights; }
            if (totalTokens > 5) { normalizedWeights[5] = _normalizedWeight5; } else { return normalizedWeights; }
            if (totalTokens > 6) { normalizedWeights[6] = _normalizedWeight6; } else { return normalizedWeights; }
            if (totalTokens > 7) { normalizedWeights[7] = _normalizedWeight7; } else { return normalizedWeights; }
        }

        return normalizedWeights;
    }

    function getLastInvariant() external view returns (uint256) {
        return _lastInvariant;
    }

    /**
     * @dev Returns the current value of the invariant.
     */
    function getInvariant() public view returns (uint256) {
        (, uint256[] memory balances, ) = _getVault().getPoolTokens(_getPoolId());

        // Since the Pool hooks always work with upscaled balances, we manually
        // upscale here for consistency
        _upscaleArray(balances, _scalingFactors());

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
        // Swaps are disabled while the emergency period is active.

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
        // Swaps are disabled while the emergency period is active.

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
        // It would be strange for a Pool's emergency period to be active before it is initialized,
        // but for consistency we prevent initialization in this case.

        WeightedPool.JoinKind kind = userData.joinKind();
        _require(kind == WeightedPool.JoinKind.INIT, Errors.UNINITIALIZED);

        uint256[] memory amountsIn = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(_getTotalTokens(), amountsIn.length);
        _upscaleArray(amountsIn, _scalingFactors());

        uint256[] memory normalizedWeights = _normalizedWeights();

        uint256 invariantAfterJoin = WeightedMath._calculateInvariant(normalizedWeights, amountsIn);

        // Set the initial BPT to the value of the invariant times the number of tokens. This makes BPT supply more
        // consistent in Pools with similar compositions but different number of tokens.
        uint256 bptAmountOut = Math.mul(invariantAfterJoin, _getTotalTokens());

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
        // All joins are disabled while the emergency period is active.

        uint256[] memory normalizedWeights = _normalizedWeights();

        // Due protocol swap fees are computed by measuring the growth of the invariant between the previous join or
        // exit event and now - the invariant's growth is due exclusively to swap fees. This avoids spending gas
        // computing them on each individual swap
        uint256 invariantBeforeJoin = WeightedMath._calculateInvariant(normalizedWeights, currentBalances);

        uint256[] memory dueProtocolFeeAmounts = _getDueProtocolFeeAmounts(
            currentBalances,
            normalizedWeights,
            _lastInvariant,
            invariantBeforeJoin,
            protocolSwapFeePercentage
        );

        // Update current balances by subtracting the protocol fee amounts
        _subtractFromAmounts(currentBalances, dueProtocolFeeAmounts);
        (uint256 bptAmountOut, uint256[] memory amountsIn) = _doJoin(currentBalances, normalizedWeights, userData);

        // Update the invariant with the balances the Pool will have after the join, in order to compute the
        // protocol swap fees due in future joins and exits.
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
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    function _joinExactTokensInForBPTOut(
        uint256[] memory currentBalances,
        uint256[] memory normalizedWeights,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        (uint256[] memory amountsIn, uint256 minBPTAmountOut) = userData.exactTokensInForBptOut();
        InputHelpers.ensureInputLengthMatch(_getTotalTokens(), amountsIn.length);

        _upscaleArray(amountsIn, _scalingFactors());

        uint256 bptAmountOut = WeightedMath._calcBptOutGivenExactTokensIn(
            currentBalances,
            normalizedWeights,
            amountsIn,
            totalSupply(),
            _swapFee
        );

        _require(bptAmountOut >= minBPTAmountOut, Errors.BPT_OUT_MIN_AMOUNT);

        return (bptAmountOut, amountsIn);
    }

    function _joinTokenInForExactBPTOut(
        uint256[] memory currentBalances,
        uint256[] memory normalizedWeights,
        bytes memory userData
    ) private view returns (uint256, uint256[] memory) {
        (uint256 bptAmountOut, uint256 tokenIndex) = userData.tokenInForExactBptOut();
        // Note that there is no maximum amountIn parameter: this is handled by `IVault.joinPool`.

        _require(tokenIndex < _getTotalTokens(), Errors.OUT_OF_BOUNDS);

        uint256[] memory amountsIn = new uint256[](_getTotalTokens());
        amountsIn[tokenIndex] = WeightedMath._calcTokenInGivenExactBptOut(
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
        virtual
        override
        returns (
            uint256 bptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
        // Exits are not completely disabled while the emergency period is active: proportional exits (exact BPT in
        // for tokens out) remain functional.

        uint256[] memory normalizedWeights = _normalizedWeights();

        if (_isEmergencyPeriodInactive()) {
            // Due protocol swap fees are computed by measuring the growth of the invariant between the previous
            // join or exit event and now - the invariant's growth is due exclusively to swap fees. This avoids
            // spending gas calculating the fees on each individual swap.
            uint256 invariantBeforeExit = WeightedMath._calculateInvariant(normalizedWeights, currentBalances);
            dueProtocolFeeAmounts = _getDueProtocolFeeAmounts(
                currentBalances,
                normalizedWeights,
                _lastInvariant,
                invariantBeforeExit,
                protocolSwapFeePercentage
            );

            // Update current balances by subtracting the protocol fee amounts
            _subtractFromAmounts(currentBalances, dueProtocolFeeAmounts);
        } else {
            // If the emergency period is active, protocol fees are not charged to avoid extra calculations and
            // reduce the potential for errors.
            dueProtocolFeeAmounts = new uint256[](_getTotalTokens());
        }

        (bptAmountIn, amountsOut) = _doExit(currentBalances, normalizedWeights, userData);

        // Update the invariant with the balances the Pool will have after the exit, in order to compute the
        // protocol swap fees due in future joins and exits.
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
            return _exitExactBPTInForTokenOut(currentBalances, normalizedWeights, userData);
        } else if (kind == ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {
            return _exitExactBPTInForTokensOut(currentBalances, userData);
        } else if (kind == ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT) {
            return _exitBPTInForExactTokensOut(currentBalances, normalizedWeights, userData);
        } else {
            _revert(Errors.UNHANDLED_EXIT_KIND);
        }
    }

    function _exitExactBPTInForTokenOut(
        uint256[] memory currentBalances,
        uint256[] memory normalizedWeights,
        bytes memory userData
    ) private view noEmergencyPeriod returns (uint256, uint256[] memory) {
        // This exit function is disabled if the emergency period is active.

        (uint256 bptAmountIn, uint256 tokenIndex) = userData.exactBptInForTokenOut();
        // Note that there is no minimum amountOut parameter: this is handled by `IVault.exitPool`.

        _require(tokenIndex < _getTotalTokens(), Errors.OUT_OF_BOUNDS);

        // We exit in a single token, so we initialize amountsOut with zeros
        uint256[] memory amountsOut = new uint256[](_getTotalTokens());

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

    function _exitExactBPTInForTokensOut(uint256[] memory currentBalances, bytes memory userData)
        private
        view
        returns (uint256, uint256[] memory)
    {
        // This exit function is the only one that is not disabled if the emergency period is active: it remains
        // unrestricted in an attempt to provide users with a mechanism to retrieve their tokens in case of an
        // emergency.
        //
        // This particular exit function remains available because it is the simplest (and therefore safest) one

        uint256 bptAmountIn = userData.exactBptInForTokensOut();
        // Note that there is no minimum amountOut parameter: this is handled by `IVault.exitPool`.

        uint256[] memory amountsOut = WeightedMath._calcTokensOutGivenExactBptIn(
            currentBalances,
            bptAmountIn,
            totalSupply()
        );

        return (bptAmountIn, amountsOut);
    }

    function _exitBPTInForExactTokensOut(
        uint256[] memory currentBalances,
        uint256[] memory normalizedWeights,
        bytes memory userData
    ) private view noEmergencyPeriod returns (uint256, uint256[] memory) {
        // This exit function is disabled if the emergency period is active.

        (uint256[] memory amountsOut, uint256 maxBPTAmountIn) = userData.bptInForExactTokensOut();
        InputHelpers.ensureInputLengthMatch(amountsOut.length, _getTotalTokens());
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
        uint256[] memory dueProtocolFeeAmounts = new uint256[](_getTotalTokens());

        // Early return if the protocol swap fee is zero, saving gas.
        if (protocolSwapFeePercentage == 0) {
            return dueProtocolFeeAmounts;
        }

        // The protocol swap fee are always paid using the token with the largest weight in the Pool. As this is the
        // token that is expected to have the largest balance, using it to pay fees should not unbalance the Pool.
        dueProtocolFeeAmounts[_maxWeightTokenIndex] = WeightedMath._calcDueTokenProtocolSwapFee(
            currentBalances[_maxWeightTokenIndex],
            normalizedWeights[_maxWeightTokenIndex],
            previousInvariant,
            currentInvariant,
            protocolSwapFeePercentage
        );

        return dueProtocolFeeAmounts;
    }

    /**
     * @dev Returns the value of the invariant given `currentBalances`, assuming they are increased by `amountsIn`. All
     * amounts are expected to be upscaled.
     */
    function _invariantAfterJoin(
        uint256[] memory currentBalances,
        uint256[] memory amountsIn,
        uint256[] memory normalizedWeights
    ) private view returns (uint256) {
        for (uint256 i = 0; i < _getTotalTokens(); ++i) {
            currentBalances[i] = currentBalances[i].add(amountsIn[i]);
        }

        return WeightedMath._calculateInvariant(normalizedWeights, currentBalances);
    }

    function _invariantAfterExit(
        uint256[] memory currentBalances,
        uint256[] memory amountsOut,
        uint256[] memory normalizedWeights
    ) private view returns (uint256) {
        _subtractFromAmounts(currentBalances, amountsOut);
        return WeightedMath._calculateInvariant(normalizedWeights, currentBalances);
    }

    /**
     * @dev Mutates `amounts` by subtracting `toSubtract` from it.
     */
    function _subtractFromAmounts(uint256[] memory amounts, uint256[] memory toSubtract) private view {
        for (uint256 i = 0; i < _getTotalTokens(); ++i) {
            amounts[i] = amounts[i].sub(toSubtract[i]);
        }
    }

    /**
     * @dev This function returns the appreciation of one BPT relative to the
     * underlying tokens. This starts at 1 when the pool is created and grows over time
     */
    function getRate() public view override returns (uint256) {
        // The initial BPT supply is equal to the invariant times the number of tokens.
        return Math.mul(getInvariant(), _getTotalTokens()).div(totalSupply());
    }
}
