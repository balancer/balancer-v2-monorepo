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
 * We need to use the BPT price as the measure to ensure we account for the change relative to the rest of
 * the pool, which could have many other tokens. The drop detected by circuit breakers is analogous to
 * impermanent loss: it is relative to the performance of the other tokens. If the entire market tanks and
 * all token balances go down together, the *relative* change would be zero, and the breaker would not be
 * triggered: even though the external price might have dropped 50 or 70%. It is only the *relative* movement
 * compared to the rest of the pool that matters.
 *
 * If we have tokens A, B, and C, If A drops 20% and B and C are unchanged, that's a simple 20% drop for A.
 * However, if A is unchanged and C increases 25%, that would also be a 20% "drop" for A 1 / 1.25 = 0.8.
 * The breaker might register a 20% drop even if both go up - if our target token lags the market. For
 * instance, if A goes up 60% and B and C double, 1.6 / 2 = 0.8.
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
        uint256 bptPrice;
        uint256 weightComplement;
        uint256 lowerBound;
        uint256 upperBound;
    }

    // Store circuit breaker information per token
    // When the circuit breaker is set, the caller passes in the lower and upper bounds (expressed as percentages),
    // and the current weight complement (1 - weight). Since this value is bounded by 1e18, which fits in ~60 bits,
    // there is no need for compression.
    //
    // We then compute and store the current BPT price, and the lower and upper bound conversion ratios, used to
    // convert the percentage bounds into BPT prices that can be directly compared to the "runtime" BPT prices.
    //
    // Since the price bounds shift along with the token weight, in general these bound ratios would need to be
    // computed every time. However, if the weight of the token and composition of the pool have not changed since
    // the circuit breaker was set, these stored values can still be used, avoiding a heavy computation.
    //
    // [      32 bits      |      32 bits      |   96 bits |   64 bits    |   16 bits   |   16 bits   |
    // [ upper bound ratio | lower bound ratio | BPT price | weight comp. | upper bound | lower bound |
    // |MSB                                                                                        LSB|
    uint256 private constant _LOWER_BOUND_OFFSET = 0;
    uint256 private constant _UPPER_BOUND_OFFSET = _LOWER_BOUND_OFFSET + _BOUND_WIDTH;
    uint256 private constant _WEIGHT_COMPLEMENT_OFFSET = _UPPER_BOUND_OFFSET + _BOUND_WIDTH;
    uint256 private constant _BPT_PRICE_OFFSET = _WEIGHT_COMPLEMENT_OFFSET + _WEIGHT_COMPLEMENT_WIDTH;
    uint256 private constant _LOWER_BOUND_RATIO_OFFSET = _BPT_PRICE_OFFSET + _BPT_PRICE_WIDTH;
    uint256 private constant _UPPER_BOUND_RATIO_OFFSET = _LOWER_BOUND_RATIO_OFFSET + _BOUND_RATIO_WIDTH;

    uint256 private constant _WEIGHT_COMPLEMENT_WIDTH = 64;
    uint256 private constant _BPT_PRICE_WIDTH = 96;
    uint256 private constant _BOUND_WIDTH = 16;
    uint256 private constant _BOUND_RATIO_WIDTH = 32;

    // We allow the  bounds to range over two orders of magnitude: 0.1 - 10. The maximum upper bound is set to 10.0
    // in 18-decimal floating point, since this fits in 64 bits, and can be shifted down to 16 bit precision without
    // much loss. Since compression would lose a lot of precision for values close to 0, we also constrain the lower
    // bound to a minimum value > 0.
    //
    // Since the bound ratios are (bound percentage)**(weightComplement), and weights are stored normalized, the maximum
    // weight complement is 1 - minimumWeight, which is 0.99 ~ 1. Therefore the ratio bounds are likewise constrained to
    // 10**1 ~ 10. So we can use this as the maximum value of both the percentage and ratio values.
    uint256 private constant _MAX_BOUND_PERCENTAGE = 10e18; // 10.0 in 18 decimal fixed point

    // Since we know the bounds fit into 64 bits, simply shifting them down to fit in 16 bits is not only faster than
    // the compression and decompression operations, but generally less lossy.
    uint256 private constant _BOUND_SHIFT_BITS = 64 - _BOUND_WIDTH;

    /**
     * @notice Returns the BPT price and weight complement values, and lower and upper bounds for a given token.
     * @dev If an upper or lower bound value is zero, it means there is no circuit breaker in that direction for the
     * given token.
     * @param circuitBreakerState - The bytes32 state of the token of interest.
     */
    function getCircuitBreakerFields(bytes32 circuitBreakerState)
        internal
        pure
        returns (CircuitBreakerParams memory params)
    {
        params.bptPrice = circuitBreakerState.decodeUint(_BPT_PRICE_OFFSET, _BPT_PRICE_WIDTH);
        params.weightComplement = circuitBreakerState.decodeUint(_WEIGHT_COMPLEMENT_OFFSET, _WEIGHT_COMPLEMENT_WIDTH);
        // Decompress the bounds by shifting left.
        params.lowerBound = circuitBreakerState.decodeUint(_LOWER_BOUND_OFFSET, _BOUND_WIDTH) << _BOUND_SHIFT_BITS;
        params.upperBound = circuitBreakerState.decodeUint(_UPPER_BOUND_OFFSET, _BOUND_WIDTH) << _BOUND_SHIFT_BITS;
    }

    /**
     * @notice Returns the dynamic lower and upper BPT price bounds for a given token, at the current weight.
     * @dev The current BPT price of the token can be directly compared to these values, to determine whether
     * the circuit breaker has tripped. If a bound is 0, it means there is no circuit breaker in that direction
     * for this token: there might be a lower bound, but no upper bound. If the current BPT price is less than
     * the lower bound, or greater than the non-zero upper bound, the transaction should revert.
     *
     * These BPT price bounds are dynamically calculated using the bound ratios. In general, the lower/upper
     * BPT price bound = bptPrice * "upper/lower bound ratio". The bound ratios are used to convert the
     * user-provided bounds (expressed as percentages) to BPT prices, at the current weight, and are given as:
     * (bound)**(weightComplement).
     *
     * For instance, given an 80/20 pool with a 90% lower bound, the weight complement of the higher-weight
     * token would be (1 - 0.8) = 0.2, so the lower BPT price bound conversion ratio would be:
     * (0.9 ** 0.2) ~ 0.9791.
     *
     * Intuitively, if you had a 50/50 pool with equal balances, the spot price and BPT price would move together:
     * a 20% drop in spot price would correspond to a 20% drop in BPT price. But with unequal weights (assuming a
     * balanced pool), the balance of a higher-weight token will respond less to a proportional change in spot
     * price than a lower weight token. Integrations coined the term "balance inertia" for this phenomenon.
     *
     * If the external price drops, all else being equal, the pool would be arbed until the percent drop in spot
     * price equaled the external price drop. Since during this process the *internal* pool price would be
     * above market, the arbers would sell cheap tokens to our unwitting pool at inflated prices, raising
     * the balance of the depreciating token, and lowering the balances of one or more other tokens.
     *
     * Using weighted math, you can compute the amountIn ratio for the arb trade as:
     * (1 / priceRatio) ** (1 - weight). For our 0.9 ratio and a weight of 0.8, this is ~ 1.0213.
     * So if you had 8000 tokens before, the ending balance would be 8000*1.0213 ~ 8170.
     *
     * Note that the higher the weight, the lower this ratio is. That means the counterparty token is going
     * out proportionally faster than the arb token is coming in: hence the non-linear relationship between
     * spot price and BPT price.
     *
     * If we call the initial balance at t0 B(t0), and set k = (1 / priceRatio) ** (1 - weight), the post-arb
     * balance at t1 is given by: B(t1) = k * B(t0). Since the BPTPrice(t0) = totalSupply * weight / B(t0),
     * and BPTPrice(t1) = totalSupply * weight / B(t1) - we are assuming no joins/exits or weight changes
     * for this example, so that the totalSupply and weight remain constant  - we can combine these equations
     * to compute the BPT price ratio BPTPrice(t1) / BPTPrice(t0) = 1/k; so BPT(t1) = BPT(t0) / k.
     *
     * So we see that the "conversion factor" between the spot price ratio and BPT Price ratio can be written
     * as above BPT(t1) = BPT(t0) * (1/k), or more simply: (BPT price) * (priceRatio) ** (1 - weight).
     *
     * If the value of the weight complement has not changed, we can use the precomputed conversion ratios stored
     * when the breaker was set. Otherwise, we need to calculate them again.
     *
     * As described in the general comments above, the bound ratios are dependent on the weight. This attempts
     * to isolate changes in the balance due to arbitrageurs responding to external prices, from internal price
     * changes caused by an ongoing weight update (or changes to the pool composition). There is a non-linear
     * relationship between "spot" price changes and BPT price changes. This calculation transforms one into
     * the other.
     *
     * @param circuitBreakerState - The bytes32 state of the token of interest.
     * @param weightComplement - The complement of this token's weight, generally given by (1 - weight).
     * @return - lower and upper BPT price bounds, which can be directly compared against the current BPT price.
     */
    function getCurrentCircuitBreakerBounds(bytes32 circuitBreakerState, uint256 weightComplement)
        internal
        pure
        returns (uint256, uint256)
    {
        // Retrieve the weight complement passed in and bptPrice computed when the circuit breaker was set.
        uint256 bptPrice = circuitBreakerState.decodeUint(_BPT_PRICE_OFFSET, _BPT_PRICE_WIDTH);
        uint256 initialWeightComplement = circuitBreakerState.decodeUint(
            _WEIGHT_COMPLEMENT_OFFSET,
            _WEIGHT_COMPLEMENT_WIDTH
        );

        uint256 lowerBoundRatio;
        uint256 upperBoundRatio;

        if (initialWeightComplement == weightComplement) {
            // If the weight complement hasn't changed since the circuit breaker was set, we can use the precomputed
            // boundary ratios.
            lowerBoundRatio = circuitBreakerState.decodeUint(_LOWER_BOUND_RATIO_OFFSET, _BOUND_RATIO_WIDTH).decompress(
                _BOUND_RATIO_WIDTH,
                _MAX_BOUND_PERCENTAGE
            );
            upperBoundRatio = circuitBreakerState.decodeUint(_UPPER_BOUND_RATIO_OFFSET, _BOUND_RATIO_WIDTH).decompress(
                _BOUND_RATIO_WIDTH,
                _MAX_BOUND_PERCENTAGE
            );
        } else {
            // Something has changed - either the weight of the token, or the composition of the pool, so we must
            // retrieve the raw percentage bounds and do the full calculation. Decompress the bounds by shifting left.
            (lowerBoundRatio, upperBoundRatio) = getBoundaryConversionRatios(
                circuitBreakerState.decodeUint(_LOWER_BOUND_OFFSET, _BOUND_WIDTH) << _BOUND_SHIFT_BITS,
                circuitBreakerState.decodeUint(_UPPER_BOUND_OFFSET, _BOUND_WIDTH) << _BOUND_SHIFT_BITS,
                weightComplement
            );
        }

        // Use the ratios retrieved (or computed) above to convert raw percentage bounds to BPT price bounds.
        // To err in favor of tripping the breaker, round the lower bound up, and the upper bound down.
        return (bptPrice.mulUp(lowerBoundRatio), bptPrice.mulDown(upperBoundRatio));
    }

    /**
     * @notice Checks whether either the lower or upper circuit breakers would trip in the given pool state.
     * @dev Compute the current BPT price from the input parameters, and compare it to the bounds to determine whether
     * the given post-operation pool state is within the circuit breaker bounds.
     * @param circuitBreakerState - the state corresponding to the token we are checking.
     * @param totalSupply - the post-operation totalSupply (including protocol fees, etc.)
     * @param normalizedWeight - the normalized weight of the token we are checking.
     * @param upscaledBalance - the post-operation token balance (including swap fees, etc.). It must be an 18-decimal
     * floating point number, adjusted by the scaling factor of the token.
     * @return - boolean flags set to true if the breaker should be tripped: (lowerBoundTripped, upperBoundTripped)
     */
    function hasCircuitBreakerTripped(
        bytes32 circuitBreakerState,
        uint256 totalSupply,
        uint256 normalizedWeight,
        uint256 upscaledBalance
    ) internal pure returns (bool, bool) {
        (uint256 lowerBoundBptPrice, uint256 upperBoundBptPrice) = getCurrentCircuitBreakerBounds(
            circuitBreakerState,
            normalizedWeight.complement()
        );
        uint256 currentBptPrice = totalSupply.mulUp(normalizedWeight).divDown(upscaledBalance);

        return (
            lowerBoundBptPrice != 0 && currentBptPrice < lowerBoundBptPrice,
            upperBoundBptPrice != 0 && currentBptPrice > upperBoundBptPrice
        );
    }

    /**
     * @notice Sets the reference BPT price, weight complement, and upper and lower bounds for a token.
     * @dev If a bound is zero, it means there is no circuit breaker in that direction for the given token.
     * @param params - CircuitBreakerParams has the following components:
     * - bptPrice: The BptPrice of the token at the time the circuit breaker is set. The BPT Price
     *   of a token is generally given by: supply * weight / balance.
     * - weightComplement: This is (1 - currentWeight).
     * - lowerBound: The value of the lower bound, expressed as a percentage.
     * - upperBound: The value of the upper bound, expressed as a percentage.
     */
    function setCircuitBreakerFields(CircuitBreakerParams memory params) internal pure returns (bytes32) {
        // It's theoretically not required for the lower bound to be < 1, but it wouldn't make much sense otherwise:
        // the circuit breaker would immediately trip. Note that this explicitly allows setting either to 0, disabling
        // the circuit breaker for the token in that direction.
        _require(params.lowerBound <= FixedPoint.ONE, Errors.INVALID_CIRCUIT_BREAKER_BOUNDS);
        _require(params.upperBound <= _MAX_BOUND_PERCENTAGE, Errors.INVALID_CIRCUIT_BREAKER_BOUNDS);
        _require(
            params.upperBound == 0 || params.upperBound >= params.lowerBound,
            Errors.INVALID_CIRCUIT_BREAKER_BOUNDS
        );

        // Set the reference parameters: BPT price of the token, and the weight complement.
        bytes32 circuitBreakerState = bytes32(0)
            .insertUint(params.bptPrice, _BPT_PRICE_OFFSET, _BPT_PRICE_WIDTH)
            .insertUint(params.weightComplement, _WEIGHT_COMPLEMENT_OFFSET, _WEIGHT_COMPLEMENT_WIDTH);

        // Add the lower and upper percentage bounds. Compress by shifting right.
        circuitBreakerState = circuitBreakerState
            .insertUint(params.lowerBound >> _BOUND_SHIFT_BITS, _LOWER_BOUND_OFFSET, _BOUND_WIDTH)
            .insertUint(params.upperBound >> _BOUND_SHIFT_BITS, _UPPER_BOUND_OFFSET, _BOUND_WIDTH);

        // Precompute and store the conversion ratios, used to convert percentage bounds to BPT price bounds.
        // If the weight complement has not changed since the breaker was set, we can use the precomputed values
        // directly, and avoid a heavy computation.
        (uint256 lowerBoundRatio, uint256 upperBoundRatio) = getBoundaryConversionRatios(
            params.lowerBound,
            params.upperBound,
            params.weightComplement
        );

        // Finally, insert these computed ratios, and return the complete set of fields.
        return
            circuitBreakerState
                .insertUint(
                lowerBoundRatio.compress(_BOUND_RATIO_WIDTH, _MAX_BOUND_PERCENTAGE),
                _LOWER_BOUND_RATIO_OFFSET,
                _BOUND_RATIO_WIDTH
            )
                .insertUint(
                upperBoundRatio.compress(_BOUND_RATIO_WIDTH, _MAX_BOUND_PERCENTAGE),
                _UPPER_BOUND_RATIO_OFFSET,
                _BOUND_RATIO_WIDTH
            );
    }

    // Convert percentage bounds to BPT price bounds
    function getBoundaryConversionRatios(
        uint256 lowerBound,
        uint256 upperBound,
        uint256 weightComplement
    ) internal pure returns (uint256 lowerBoundRatio, uint256 upperBoundRatio) {
        // To be conservative and protect LPs, round up for the lower bound, and down for the upper bound.
        lowerBoundRatio = lowerBound.powUp(weightComplement);
        upperBoundRatio = upperBound.powDown(weightComplement);
    }
}
