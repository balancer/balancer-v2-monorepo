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
 * @title Circuit Breaker Library
 * @notice Library for storing and manipulating state related to circuit breakers.
 * @dev The intent of circuit breakers is to halt trading of a given token if its value changes drastically -
 * in either direction - with respect to other tokens in the pool. For instance, a stable coin might de-peg
 * and go to zero. With no safeguards, arbitrageurs could drain the pool by selling large amounts of the
 * token to the pool at inflated internal prices.
 *
 * The circuit breaker mechanism establishes a "safe trading range" for each token, expressed in terms of
 * the BPT price. Both lower and upper bounds can be set, and if a trade would result in moving the BPT price
 * of any token involved in the operation outside that range, the breaker is "tripped", and the operation
 * should revert. Each token is independent, since some might have very "tight" valid trading ranges, such as
 * stable coins, and others are more volatile.
 *
 * The BPT price of a token is defined as the amount of BPT that could be redeemed for a single token.
 * For instance, in an 80/20 pool with a total supply of 1000, the 80% token accounts for 800 BPT. So each
 * token would be worth 800 / token balance. The formula is then: total supply * token weight / token balance.
 * (Note that this only applies *if* the pool is balanced (a condition that cannot be checked by the pool without
 * accessing price oracles.)
 *
 * Since BPT prices are not intuitive - and there is a very non-linear relationship between "spot" prices and
 * BPT prices - circuit breakers are set using simple percentages. Intuitively, a lower bound of 0.8 means the
 * token can lose 20% of its value before triggering the circuit breaker, and an upper bound of 3.0 means it
 * can triple before being halted. These percentages are then transformed into BPT prices for comparison to the
 * "reference" state of the pool when the circuit breaker was set.
 *
 * Prices can change in two ways: arbitrage traders responding to external price movement can change the balances,
 * or an ongoing gradual weight update (or change in pool composition) can change the weights. In order to isolate
 * the balance changes due to price movement, the bounds are dynamic, adjusted for the current weight.
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
    // When the circuit breaker is set, store the "reference" values of parameters needed to compute the dynamic
    // BPT price bounds for validating operations.
    //
    // The reference parameters include the BPT price, weight complement (_denormWeightSum - weight), and bound
    // conversion ratios. These ratios are used to convert percentage bounds into BPT prices that can be directly
    // compared to the "runtime" BPT prices.
    //
    // Since the price bounds shift along with the token weight, in general these bound ratios would need to be
    // computed every time. However, if the weight of the token and composition of the pool have not changed since
    // the circuit breaker was set, these "cached" reference values can still be used, avoiding a heavy computation.
    //
    // We also store the "raw" upper and lower bounds, expressed as 18-decimal floating point percentages, for
    // human readability.
    //
    // [    24 bits   |    24 bits   |     16 bits       |   16 bits     |      64 bits     |    112 bits   |
    // [ ref UB ratio | ref LB ratio | upper bound pct | lower bound pct | ref weight comp. | ref BPT price |
    // |MSB                                                                                              LSB|
    uint256 private constant _REF_BPT_PRICE_OFFSET = 0;
    uint256 private constant _REF_WEIGHT_COMPLEMENT_OFFSET = _REF_BPT_PRICE_OFFSET + _REF_BPT_PRICE_WIDTH;
    uint256 private constant _LOWER_BOUND_PCT_OFFSET = _REF_WEIGHT_COMPLEMENT_OFFSET + _REF_WEIGHT_COMPLEMENT_WIDTH;
    uint256 private constant _UPPER_BOUND_PCT_OFFSET = _LOWER_BOUND_PCT_OFFSET + _BOUND_PERCENTAGE_WIDTH;
    uint256 private constant _REF_LOWER_BOUND_RATIO_OFFSET = _UPPER_BOUND_PCT_OFFSET + _BOUND_PERCENTAGE_WIDTH;
    uint256 private constant _REF_UPPER_BOUND_RATIO_OFFSET = _REF_LOWER_BOUND_RATIO_OFFSET + _BOUND_RATIO_WIDTH;

    uint256 private constant _REF_WEIGHT_COMPLEMENT_WIDTH = 64;
    uint256 private constant _REF_BPT_PRICE_WIDTH = 112;
    uint256 private constant _BOUND_PERCENTAGE_WIDTH = 16;
    uint256 private constant _BOUND_RATIO_WIDTH = 24;

    // We compress the ratios from a range of [0, 10e18], chosen to allow the upper bound to exceed 1.
    // For consistency, use the same max value to compress the lower bound, even though we expect it to be less than 1.
    uint256 private constant _MAX_BOUND_PERCENTAGE = 10e18; // 10.0 in 18 decimal fixed point

    /**
     * @notice Returns the reference BPT price and weight complement values, and percentage bounds for a given token.
     * @dev If an upper or lower bound value is zero, it means there is no circuit breaker in that direction for the
     * given token.
     * @param circuitBreakerState - The bytes32 state of the token of interest.
     */
    function getCircuitBreakerFields(bytes32 circuitBreakerState) internal pure returns (CircuitBreakerParams memory) {
        return
            CircuitBreakerParams({
                referenceBptPrice: circuitBreakerState.decodeUint(_REF_BPT_PRICE_OFFSET, _REF_BPT_PRICE_WIDTH),
                referenceWeightComplement: circuitBreakerState
                    .decodeUint(_REF_WEIGHT_COMPLEMENT_OFFSET, _REF_WEIGHT_COMPLEMENT_WIDTH)
                    .decompress(_REF_WEIGHT_COMPLEMENT_WIDTH, _MAX_BOUND_PERCENTAGE),
                lowerBoundPercentage: circuitBreakerState
                    .decodeUint(_LOWER_BOUND_PCT_OFFSET, _BOUND_PERCENTAGE_WIDTH)
                    .decompress(_BOUND_PERCENTAGE_WIDTH, _MAX_BOUND_PERCENTAGE),
                upperBoundPercentage: circuitBreakerState
                    .decodeUint(_UPPER_BOUND_PCT_OFFSET, _BOUND_PERCENTAGE_WIDTH)
                    .decompress(_BOUND_PERCENTAGE_WIDTH, _MAX_BOUND_PERCENTAGE)
            });
    }

    /**
     * @notice Returns the dynamic lower and upper BPT price bounds for a given token, at the current weight.
     * @dev The current BPT price of the token can be directly compared to these values, to determine whether
     * the circuit breaker has tripped. If a bound is 0, it means there is no circuit breaker in that direction
     * for this token: there might be a lower bound, but no upper bound. If the current BPT price is less than
     * the lower bound, or greater than the non-zero upper bound, the transaction should revert.
     *
     * These BPT price bounds are dynamically calculated using the conversion ratios. In general:
     * lower/upper BPT price bound = referenceBptPrice * "conversion ratio". The conversion ratio is given as
     * (boundary percentage)**(currentWeightComplement).
     *
     * If the value of the weight complement has not changed, we can use the reference conversion ratios stored
     * when the breaker was set. Otherwise, we need to calculate them.
     *
     * As described in the general comments above, the weight complement calculation attempts to isolate changes
     * in the balance due to arbitrageurs responding to external prices, from internal price changes caused by an
     * ongoing weight update, or changes to the pool composition. There is a non-linear relationship between "spot"
     * price changes and BPT price changes. This calculation transforms one into the other.
     *
     * @param circuitBreakerState - The bytes32 state of the token of interest.
     * @param currentWeightComplement - The complement of this token's weight: (_denormWeightSum - token weight)
     * @return - lower and upper BPT price bounds, which can be directly compared against the current BPT price.
     */
    function getCurrentCircuitBreakerBounds(bytes32 circuitBreakerState, uint256 currentWeightComplement)
        internal
        pure
        returns (uint256, uint256)
    {
        uint256 referenceBptPrice = circuitBreakerState.decodeUint(_REF_BPT_PRICE_OFFSET, _REF_BPT_PRICE_WIDTH);
        uint256 referenceWeightComplement = circuitBreakerState
            .decodeUint(_REF_WEIGHT_COMPLEMENT_OFFSET, _REF_WEIGHT_COMPLEMENT_WIDTH)
            .decompress(_REF_WEIGHT_COMPLEMENT_WIDTH, _MAX_BOUND_PERCENTAGE);

        uint256 lowerBoundRatio;
        uint256 upperBoundRatio;

        if (referenceWeightComplement == currentWeightComplement) {
            // If the weight factor hasn't changed since the circuit breaker was set, we can use the precomputed
            // boundary expressions.
            lowerBoundRatio = circuitBreakerState
                .decodeUint(_REF_LOWER_BOUND_RATIO_OFFSET, _BOUND_RATIO_WIDTH)
                .decompress(_BOUND_RATIO_WIDTH, _MAX_BOUND_PERCENTAGE);
            upperBoundRatio = circuitBreakerState
                .decodeUint(_REF_UPPER_BOUND_RATIO_OFFSET, _BOUND_RATIO_WIDTH)
                .decompress(_BOUND_RATIO_WIDTH, _MAX_BOUND_PERCENTAGE);
        } else {
            // Something has changed - either the weight of the token, or the composition of the pool, so we must
            // retrieve the raw percentage bounds and do the full calculation.
            (lowerBoundRatio, upperBoundRatio) = getBoundaryConversionRatios(
                circuitBreakerState.decodeUint(_LOWER_BOUND_PCT_OFFSET, _BOUND_PERCENTAGE_WIDTH).decompress(
                    _BOUND_PERCENTAGE_WIDTH,
                    _MAX_BOUND_PERCENTAGE
                ),
                circuitBreakerState.decodeUint(_UPPER_BOUND_PCT_OFFSET, _BOUND_PERCENTAGE_WIDTH).decompress(
                    _BOUND_PERCENTAGE_WIDTH,
                    _MAX_BOUND_PERCENTAGE
                ),
                currentWeightComplement
            );
        }

        // Use these ratios to convert raw percentage bounds to BPT price bounds.
        // To err in favor of tripping the breaker, round the lower bound up, and the upper bound down.
        return (referenceBptPrice.mulUp(lowerBoundRatio), referenceBptPrice.mulDown(upperBoundRatio));
    }

    /**
     * @notice Sets the reference BPT price, weight complement, and upper and lower bounds for a token.
     * @dev If a bound is zero, it means there is no circuit breaker in that direction for the given token.
     * @param circuitBreakerState - The bytes32 state of the token of interest.
     * @param params - CircuitBreakerParams has the following components:
     * - referenceBptPrice: The BptPrice of the token at the time the circuit breaker is set. The BPT Price
     *   of a token is generally given by: supply * weight / balance.
     * - referenceWeightComplement: This is _denormWeightSum - currentWeight of the token.
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
        // the circuit breaker would immediately trip. Note that this explicitly allows setting either to 0, disabling
        // the circuit breaker for the token in that direction.
        _require(params.lowerBoundPercentage <= FixedPoint.ONE, Errors.INVALID_CIRCUIT_BREAKER_BOUNDS);
        _require(params.upperBoundPercentage <= _MAX_BOUND_PERCENTAGE, Errors.INVALID_CIRCUIT_BREAKER_BOUNDS);
        _require(
            params.upperBoundPercentage == 0 || params.upperBoundPercentage >= params.lowerBoundPercentage,
            Errors.INVALID_CIRCUIT_BREAKER_BOUNDS
        );

        // Set the reference parameters: BPT price of the token, and the weight complement.
        circuitBreakerState = circuitBreakerState
            .insertUint(params.referenceBptPrice, _REF_BPT_PRICE_OFFSET, _REF_BPT_PRICE_WIDTH)
            .insertUint(
            params.referenceWeightComplement.compress(_REF_WEIGHT_COMPLEMENT_WIDTH, _MAX_BOUND_PERCENTAGE),
            _REF_WEIGHT_COMPLEMENT_OFFSET,
            _REF_WEIGHT_COMPLEMENT_WIDTH
        );

        // Add the lower and upper percentage bounds.
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

        // Precompute and store the conversion ratios, used to convert percentage bounds to BPT price bounds.
        // If the weight complement has not changed since the breaker was set (i.e., if there is no ongoing weight
        // update, and no tokens have been added or removed), we can use the reference values directly, and avoid
        // a heavy computation.
        (uint256 lowerBoundRatioCache, uint256 upperBoundRatioCache) = getBoundaryConversionRatios(
            params.lowerBoundPercentage,
            params.upperBoundPercentage,
            params.referenceWeightComplement
        );

        // Finally, insert these computed reference ratios, and return the complete set of fields.
        return
            circuitBreakerState
                .insertUint(
                lowerBoundRatioCache.compress(_BOUND_RATIO_WIDTH, _MAX_BOUND_PERCENTAGE),
                _REF_LOWER_BOUND_RATIO_OFFSET,
                _BOUND_RATIO_WIDTH
            )
                .insertUint(
                upperBoundRatioCache.compress(_BOUND_RATIO_WIDTH, _MAX_BOUND_PERCENTAGE),
                _REF_UPPER_BOUND_RATIO_OFFSET,
                _BOUND_RATIO_WIDTH
            );
    }

    // Convert percentage bounds to BPT price bounds
    function getBoundaryConversionRatios(
        uint256 lowerBoundPercentage,
        uint256 upperBoundPercentage,
        uint256 currentWeightComplement
    ) internal pure returns (uint256 lowerBoundRatioCache, uint256 upperBoundRatioCache) {
        // Rounding down for the lower bound, and up for the upper bound will maximize the
        // "operating range" - the BPT price range that will not trigger the circuit breaker -
        // of the pool for traders.
        lowerBoundRatioCache = lowerBoundPercentage.powDown(currentWeightComplement);
        upperBoundRatioCache = upperBoundPercentage.powUp(currentWeightComplement);
    }
}
