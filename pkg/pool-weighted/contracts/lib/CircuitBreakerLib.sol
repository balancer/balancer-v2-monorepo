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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "../lib/ValueCompression.sol";

/**
 * @title Managed Pool Circuit Breaker Library
 * @notice Library for storing and manipulating state related to circuit breakers in ManagedPool.
 * @dev BPT price = supply / balance / weight. The lower and upper bounds are percentages.
 * For instance, a lower bound of 0.8 means the circuit breaker will trip if the token price
 * drops more than 20% (relative to other tokens). An upper bound ratio of 2.0 means it will trip
 * if the price more than doubles.
 */
library CircuitBreakerLib {
    using ValueCompression for uint256;
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    struct CircuitBreakerParams {
        uint256 referenceBptPrice;
        uint256 referenceWeightComplement;
        uint256 lowerBoundPercentage;
        uint256 upperBoundPercentage;
    }

    // Store circuit breaker information per token
    // [  24 bits |  24 bits |   16 bits   |   16 bits   |    64 bits    |  112 bits |
    // [ UB ratio | LB ratio | upper bound | lower bound | weight factor | ref price |
    // |MSB                                                                       LSB|
    uint256 private constant _REFERENCE_BPT_PRICE_OFFSET = 0;
    uint256 private constant _REFERENCE_WEIGHT_COMPLEMENT_OFFSET = _REFERENCE_BPT_PRICE_OFFSET + _REFERENCE_BPT_PRICE_WIDTH;
    uint256 private constant _LOWER_BOUND_PCT_OFFSET = _REFERENCE_WEIGHT_COMPLEMENT_OFFSET + _REFERENCE_WEIGHT_COMPLEMENT_WIDTH;
    uint256 private constant _UPPER_BOUND_PCT_OFFSET = _LOWER_BOUND_PCT_OFFSET + _BOUND_PERCENTAGE_WIDTH;
    uint256 private constant _REFERENCE_LOWER_BOUND_RATIO_OFFSET = _UPPER_BOUND_PCT_OFFSET + _BOUND_PERCENTAGE_WIDTH;
    uint256 private constant _REFERENCE_UPPER_BOUND_RATIO_OFFSET = _REFERENCE_LOWER_BOUND_RATIO_OFFSET +
        _BOUND_RATIO_WIDTH;

    uint256 private constant _REFERENCE_WEIGHT_COMPLEMENT_WIDTH = 64;
    uint256 private constant _REFERENCE_BPT_PRICE_WIDTH = 112;
    uint256 private constant _BOUND_PERCENTAGE_WIDTH = 16;
    uint256 private constant _BOUND_RATIO_WIDTH = 24;

    // We compress the ratios into 16 bits from a range of [0, 10e18], chosen to allow the upper bound to exceed 1.
    // For consistency, use the same max value to compress the lower bound as well, even though we expect it to be
    // less than 1.
    uint256 private constant _MAX_BOUND_PERCENTAGE = 10e18; // 10.0 in 18 decimal fixed point

    /**
     * @notice Returns the reference BPT price, reference weight factor, and upper and lower bounds for a given token.
     * @dev If a bound value is zero, it means there is no circuit breaker in that direction for the given token.
     * @param circuitBreakerState - The bytes32 state of the token of interest.
     */
    function getCircuitBreakerFields(bytes32 circuitBreakerState) internal pure returns (CircuitBreakerParams memory) {
        return
            CircuitBreakerParams({
                referenceBptPrice: circuitBreakerState.decodeUint(
                    _REFERENCE_BPT_PRICE_OFFSET,
                    _REFERENCE_BPT_PRICE_WIDTH
                ),
                referenceWeightComplement: circuitBreakerState
                    .decodeUint(_REFERENCE_WEIGHT_COMPLEMENT_OFFSET, _REFERENCE_WEIGHT_COMPLEMENT_WIDTH)
                    .decompress(_REFERENCE_WEIGHT_COMPLEMENT_WIDTH, _MAX_BOUND_PERCENTAGE),
                lowerBoundPercentage: circuitBreakerState
                    .decodeUint(_LOWER_BOUND_PCT_OFFSET, _BOUND_PERCENTAGE_WIDTH)
                    .decompress(_BOUND_PERCENTAGE_WIDTH, _MAX_BOUND_PERCENTAGE),
                upperBoundPercentage: circuitBreakerState
                    .decodeUint(_UPPER_BOUND_PCT_OFFSET, _BOUND_PERCENTAGE_WIDTH)
                    .decompress(_BOUND_PERCENTAGE_WIDTH, _MAX_BOUND_PERCENTAGE)
            });
    }

    /**
     * @notice Returns the dynamic upper and lower bounds for a given token, at the current weight.
     * @dev If a bound value is zero, it means there is no circuit breaker in that direction for the given token.
     * The current boundary is given as: referenceBptPrice * (raw boundary percentage)**(currentWeightComplement).
     *
     * The weight factor calculation attempts to isolate changes in the balance due to arbers responding to external
     * prices, and internal price changes from moving weights. There is a non-linear relationship between "spot" price
     * changes and BPT price changes, so this calculation transforms one into the other.
     *
     * The raw thresholds are simple percentages: 0.8 means "tolerate a 20% drop in external price." To check the
     * circuit breaker at runtime, we need to transform that into a corresponding BPT price ratio (relative to the
     * BPT price at the time the breaker is set), such that the final boundary to be checked is simply the original
     * reference BPT price multiplied by this conversion ratio.
     * @param circuitBreakerState - The bytes32 state of the token of interest.
     * @param currentWeightComplement - The combined weight of all other tokens: (_denormWeightSum - token weight)
     * @return - lower and upper BPT price bounds, which can be directly compared against the current BPT price.
     */
    function getCurrentCircuitBreakerBounds(bytes32 circuitBreakerState, uint256 currentWeightComplement)
        internal
        pure
        returns (uint256, uint256)
    {
        // Retrieve the reference bptPrice and weight factors, stored at the time the circuit breaker was set.
        uint256 referenceBptPrice = circuitBreakerState.decodeUint(
            _REFERENCE_BPT_PRICE_OFFSET,
            _REFERENCE_BPT_PRICE_WIDTH
        );
        uint256 referenceWeightComplement = circuitBreakerState
            .decodeUint(_REFERENCE_WEIGHT_COMPLEMENT_OFFSET, _REFERENCE_WEIGHT_COMPLEMENT_WIDTH)
            .decompress(_REFERENCE_WEIGHT_COMPLEMENT_WIDTH, _MAX_BOUND_PERCENTAGE);

        if (referenceWeightComplement == currentWeightComplement) {
            // If the weight factor hasn't changed since the circuit breaker was set, we can use the precomputed
            // boundary expressions.
            return (
                referenceBptPrice.mulDown(
                    circuitBreakerState.decodeUint(_REFERENCE_LOWER_BOUND_RATIO_OFFSET, _BOUND_RATIO_WIDTH).decompress(
                        _BOUND_RATIO_WIDTH,
                        _MAX_BOUND_PERCENTAGE
                    )
                ),
                referenceBptPrice.mulUp(
                    circuitBreakerState.decodeUint(_REFERENCE_UPPER_BOUND_RATIO_OFFSET, _BOUND_RATIO_WIDTH).decompress(
                        _BOUND_RATIO_WIDTH,
                        _MAX_BOUND_PERCENTAGE
                    )
                )
            );
        } else {
            // Something has changed - either the weight of the token, or the total weight (e.g., another token was
            // added or removed), so we must retrieve the raw bounds and do the full calculation.
            uint256 lowerBoundPercentage = circuitBreakerState
                .decodeUint(_LOWER_BOUND_PCT_OFFSET, _BOUND_PERCENTAGE_WIDTH)
                .decompress(_BOUND_PERCENTAGE_WIDTH, _MAX_BOUND_PERCENTAGE);

            uint256 upperBoundPercentage = circuitBreakerState
                .decodeUint(_UPPER_BOUND_PCT_OFFSET, _BOUND_PERCENTAGE_WIDTH)
                .decompress(_BOUND_PERCENTAGE_WIDTH, _MAX_BOUND_PERCENTAGE);

            // Use these ratios to convert raw percentage bounds to BPT price bounds.
            (uint256 lowerBoundRatioCache, uint256 upperBoundRatioCache) = _getBoundaryConversionRatios(
                lowerBoundPercentage,
                upperBoundPercentage,
                currentWeightComplement
            );

            return (referenceBptPrice.mulDown(lowerBoundRatioCache), referenceBptPrice.mulUp(upperBoundRatioCache));
        }
    }

    /**
     * @notice Sets the reference BPT price, and upper and lower bounds for a token.
     * @dev If a bound is zero, it means there is no circuit breaker in that direction for the given token.
     * @param circuitBreakerState - The bytes32 state of the token of interest.
     * @param params - CircuitBreakerParams has the following components:
     * - referenceBptPrice: The BptPrice of the token at the time the circuit breaker is set. The BPT Price
     *   of a token is generally given by: supply * weight / balance.
     * - currentWeightComplement: This is _denormWeightSum - currentWeight of the token.
     * - lowerBoundPercentage: The value of the lower bound. Any operation that would cause the effective
     *   BPT Price to fall below lowerBoundRatio * referenceBptPrice should revert.
     * - upperBoundPercentage: The value of the upper bound. If non-zero, any operation that would cause the
     *   effective BPT Price to rise above upperBoundRatio * referenceBptPrice should revert.
     */
    function setCircuitBreakerFields(bytes32 circuitBreakerState, CircuitBreakerParams memory params)
        internal
        pure
        returns (bytes32)
    {
        // It's theoretically not required for the lower bound to be < 1, but it wouldn't make much sense otherwise:
        // the circuit breaker would immediately trip. Note that this explicitly allows setting both to 0, disabling
        // the circuit breaker for the token.
        _require(params.lowerBoundPercentage <= FixedPoint.ONE, Errors.INVALID_CIRCUIT_BREAKER_BOUNDS);
        _require(params.upperBoundPercentage <= _MAX_BOUND_PERCENTAGE, Errors.INVALID_CIRCUIT_BREAKER_BOUNDS);
        _require(
            params.upperBoundPercentage == 0 || params.upperBoundPercentage >= params.lowerBoundPercentage,
            Errors.INVALID_CIRCUIT_BREAKER_BOUNDS
        );

        // Set the reference parameters: BPT price of the token, and the weight factor for the token:
        // _denormWeightSum - weight.
        circuitBreakerState = circuitBreakerState
            .insertUint(params.referenceBptPrice, _REFERENCE_BPT_PRICE_OFFSET, _REFERENCE_BPT_PRICE_WIDTH)
            .insertUint(
            params.referenceWeightComplement.compress(_REFERENCE_WEIGHT_COMPLEMENT_WIDTH, _MAX_BOUND_PERCENTAGE),
            _REFERENCE_WEIGHT_COMPLEMENT_OFFSET,
            _REFERENCE_WEIGHT_COMPLEMENT_WIDTH
        );

        // Add the lower nad upper percentage bounds.
        circuitBreakerState = circuitBreakerState
            .insertUint(
            params.lowerBoundPercentage.compress(_BOUND_PERCENTAGE_WIDTH, _MAX_BOUND_PERCENTAGE),
            _LOWER_BOUND_PCT_OFFSET,
            _BOUND_PERCENTAGE_WIDTH
        )
            .insertUint(
            params.upperBoundPercentage.compress(_BOUND_PERCENTAGE_WIDTH, _MAX_BOUND_PERCENTAGE),
            _UPPER_BOUND_PCT_OFFSET,
            _BOUND_PERCENTAGE_WIDTH
        );

        // Precompute and store the conversion ratios, used to convert percentage bounds to BPT prices.
        // If the weight factor has not changed since the breaker was set (i.e., if there is no ongoing weight
        // update, and no tokens have been added or removed), we can use the reference values directly, and avoid
        // a heavy computation.
        (uint256 lowerBoundRatioCache, uint256 upperBoundRatioCache) = _getBoundaryConversionRatios(
            params.lowerBoundPercentage,
            params.upperBoundPercentage,
            params.referenceWeightComplement
        );

        // Finally, insert these computed reference ratios, and return the complete set of fields.
        return
            circuitBreakerState
                .insertUint(
                lowerBoundRatioCache.compress(_BOUND_RATIO_WIDTH, _MAX_BOUND_PERCENTAGE),
                _REFERENCE_LOWER_BOUND_RATIO_OFFSET,
                _BOUND_RATIO_WIDTH
            )
                .insertUint(
                upperBoundRatioCache.compress(_BOUND_RATIO_WIDTH, _MAX_BOUND_PERCENTAGE),
                _REFERENCE_UPPER_BOUND_RATIO_OFFSET,
                _BOUND_RATIO_WIDTH
            );
    }

    // Convert percentage bounds to BPT price bounds
    function _getBoundaryConversionRatios(
        uint256 lowerBoundPercentage,
        uint256 upperBoundPercentage,
        uint256 currentWeightComplement
    ) private pure returns (uint256 lowerBoundRatioCache, uint256 upperBoundRatioCache) {
        // Rounding down for the lower bound, and up for the upper bound will maximize the
        // "operating range" - the BPT price range that will not trigger the circuit breaker -
        // of the pool for traders.
        lowerBoundRatioCache = lowerBoundPercentage.powDown(currentWeightComplement);
        upperBoundRatioCache = upperBoundPercentage.powUp(currentWeightComplement);
    }
}
