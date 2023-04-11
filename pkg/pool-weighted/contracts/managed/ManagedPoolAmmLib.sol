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

import "@balancer-labs/v2-interfaces/contracts/pool-weighted/IExternalWeightedMath.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";

import "@balancer-labs/v2-pool-utils/contracts/lib/ComposablePoolLib.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/ScalingHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/Authentication.sol";

import "../managed/CircuitBreakerStorageLib.sol";
import "./ManagedPoolTokenStorageLib.sol";
import "./ManagedPoolStorageLib.sol";

library ManagedPoolAmmLib {
    using FixedPoint for uint256;
    using WeightedPoolUserData for bytes;

    enum BoundCheckKind { LOWER, UPPER, BOTH }

    function joinPool(
        uint256[] memory balances,
        bytes memory userData,
        uint256 actualSupply,
        uint256[] memory scalingFactors,
        uint256[] memory normalizedWeights,
        bytes32 poolState,
        bytes32[] memory circuitBreakerStates,
        IExternalWeightedMath weightedMath
    ) external view returns (uint256 bptAmountOut, uint256[] memory amountsIn) {
        _upscaleArray(balances, scalingFactors);

        (bptAmountOut, amountsIn) = _doJoin(
            balances,
            normalizedWeights,
            scalingFactors,
            actualSupply,
            userData,
            poolState,
            weightedMath
        );

        checkCircuitBreakers(
            actualSupply.add(bptAmountOut),
            circuitBreakerStates,
            balances,
            amountsIn,
            normalizedWeights,
            true
        );

        // amountsIn are amounts entering the Pool, so we round up.
        _downscaleUpArray(amountsIn, scalingFactors);

        // The Vault expects an array of amounts which includes BPT so prepend an empty element to this array.
        amountsIn = ComposablePoolLib.prependZeroElement(amountsIn);
    }

    /**
     * @dev Dispatch code which decodes the provided userdata to perform the specified join type.
     */
    function _doJoin(
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        uint256 totalSupply,
        bytes memory userData,
        bytes32 poolState,
        IExternalWeightedMath weightedMath
    ) private view returns (uint256, uint256[] memory) {
        // Check whether joins are enabled.
        _require(ManagedPoolStorageLib.getJoinExitEnabled(poolState), Errors.JOINS_EXITS_DISABLED);

        WeightedPoolUserData.JoinKind kind = userData.joinKind();

        // If swaps are disabled, only proportional joins are allowed. All others involve implicit swaps, and alter
        // token prices.
        _require(
            ManagedPoolStorageLib.getSwapEnabled(poolState) ||
                kind == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT,
            Errors.INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED
        );

        if (kind == WeightedPoolUserData.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT) {
            return
                weightedMath.joinExactTokensInForBPTOut(
                    balances,
                    normalizedWeights,
                    scalingFactors,
                    totalSupply,
                    ManagedPoolStorageLib.getSwapFeePercentage(poolState),
                    userData
                );
        } else if (kind == WeightedPoolUserData.JoinKind.TOKEN_IN_FOR_EXACT_BPT_OUT) {
            return
                weightedMath.joinTokenInForExactBPTOut(
                    balances,
                    normalizedWeights,
                    totalSupply,
                    ManagedPoolStorageLib.getSwapFeePercentage(poolState),
                    userData
                );
        } else if (kind == WeightedPoolUserData.JoinKind.ALL_TOKENS_IN_FOR_EXACT_BPT_OUT) {
            return weightedMath.joinAllTokensInForExactBPTOut(balances, totalSupply, userData);
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    function exitPool(
        uint256[] memory balances,
        bytes memory userData,
        uint256 actualSupply,
        uint256[] memory scalingFactors,
        uint256[] memory normalizedWeights,
        bytes32 poolState,
        bytes32[] memory circuitBreakerStates,
        IExternalWeightedMath weightedMath
    ) external view returns (uint256 bptAmountIn, uint256[] memory amountsOut) {
        _upscaleArray(balances, scalingFactors);

        (bptAmountIn, amountsOut) = _doExit(
            balances,
            normalizedWeights,
            scalingFactors,
            actualSupply,
            userData,
            poolState,
            weightedMath
        );

        // Do not check circuit breakers on proportional exits, which do not change BPT prices.
        if (userData.exitKind() != WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {
            checkCircuitBreakers(
                actualSupply.sub(bptAmountIn),
                circuitBreakerStates,
                balances,
                amountsOut,
                normalizedWeights,
                false
            );
        }

        // amountsOut are amounts exiting the Pool, so we round down.
        _downscaleDownArray(amountsOut, scalingFactors);

        // The Vault expects an array of amounts which includes BPT so prepend an empty element to this array.
        amountsOut = ComposablePoolLib.prependZeroElement(amountsOut);
    }

    function _doExit(
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory scalingFactors,
        uint256 totalSupply,
        bytes memory userData,
        bytes32 poolState,
        IExternalWeightedMath weightedMath
    ) private view returns (uint256, uint256[] memory) {
        // Check whether exits are enabled. Recovery mode exits are not blocked by this check, since they are routed
        // through a different codepath at the base pool layer.
        _require(ManagedPoolStorageLib.getJoinExitEnabled(poolState), Errors.JOINS_EXITS_DISABLED);

        WeightedPoolUserData.ExitKind kind = userData.exitKind();

        // If swaps are disabled, only proportional exits are allowed. All others involve implicit swaps, and alter
        // token prices.
        _require(
            ManagedPoolStorageLib.getSwapEnabled(poolState) ||
                kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT,
            Errors.INVALID_JOIN_EXIT_KIND_WHILE_SWAPS_DISABLED
        );

        // Note that we do not check the LP allowlist here. LPs must always be able to exit the pool,
        // and enforcing the allowlist would allow the manager to perform DOS attacks on LPs.

        if (kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT) {
            return
                weightedMath.exitExactBPTInForTokenOut(
                    balances,
                    normalizedWeights,
                    totalSupply,
                    ManagedPoolStorageLib.getSwapFeePercentage(poolState),
                    userData
                );
        } else if (kind == WeightedPoolUserData.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT) {
            return weightedMath.exitExactBPTInForTokensOut(balances, totalSupply, userData);
        } else if (kind == WeightedPoolUserData.ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT) {
            return
                weightedMath.exitBPTInForExactTokensOut(
                    balances,
                    normalizedWeights,
                    scalingFactors,
                    totalSupply,
                    ManagedPoolStorageLib.getSwapFeePercentage(poolState),
                    userData
                );
        } else {
            _revert(Errors.UNHANDLED_EXIT_KIND);
        }
    }

    /**
     * @dev Check circuit breakers for a set of tokens. The given virtual supply is what it will be post-operation:
     * this includes any pending external fees, and the amount of BPT exchanged (swapped, minted, or burned) in the
     * current operation.
     *
     * We pass in the tokens, upscaled balances, and weights necessary to compute BPT prices, then check the circuit
     * breakers. Unlike a straightforward token swap, where we know the direction the BPT price will move, once the
     * virtual supply changes, all bets are off. To be safe, we need to check both directions for all tokens.
     *
     * It does attempt to short circuit quickly if there is no bound set.
     */
    function checkCircuitBreakers(
        uint256 actualSupply,
        bytes32[] memory circuitBreakerStates,
        uint256[] memory balances,
        uint256[] memory amounts,
        uint256[] memory normalizedWeights,
        bool isJoin
    ) public pure {
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 finalBalance = (isJoin ? FixedPoint.add : FixedPoint.sub)(balances[i], amounts[i]);

            // Since we cannot be sure which direction the BPT price of the token has moved,
            // we must check both the lower and upper bounds.
            checkCircuitBreaker(
                BoundCheckKind.BOTH,
                circuitBreakerStates[i],
                actualSupply,
                finalBalance,
                normalizedWeights[i]
            );
        }
    }

    // Check the appropriate circuit breaker(s) according to the BoundCheckKind.
    function checkCircuitBreaker(
        BoundCheckKind checkKind,
        bytes32 circuitBreakerState,
        uint256 actualSupply,
        uint256 balance,
        uint256 weight
    ) public pure {
        if (checkKind == BoundCheckKind.LOWER || checkKind == BoundCheckKind.BOTH) {
            checkOneSidedCircuitBreaker(circuitBreakerState, actualSupply, balance, weight, true);
        }

        if (checkKind == BoundCheckKind.UPPER || checkKind == BoundCheckKind.BOTH) {
            checkOneSidedCircuitBreaker(circuitBreakerState, actualSupply, balance, weight, false);
        }
    }

    // Check either the lower or upper bound circuit breaker for the given token.
    function checkOneSidedCircuitBreaker(
        bytes32 circuitBreakerState,
        uint256 actualSupply,
        uint256 balance,
        uint256 weight,
        bool isLowerBound
    ) public pure {
        uint256 bound = CircuitBreakerStorageLib.getBptPriceBound(circuitBreakerState, weight, isLowerBound);

        _require(
            !CircuitBreakerLib.hasCircuitBreakerTripped(actualSupply, weight, balance, bound, isLowerBound),
            Errors.CIRCUIT_BREAKER_TRIPPED
        );
    }
}
