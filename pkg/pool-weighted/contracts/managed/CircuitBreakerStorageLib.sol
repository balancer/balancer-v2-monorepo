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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "../lib/ValueCompression.sol";
import "../lib/CircuitBreakerLib.sol";

/**
 * @title Circuit Breaker Storage Library
 * @notice Library for storing and manipulating state related to circuit breakers.
 * @dev The intent of circuit breakers is to halt trading of a given token if its value changes drastically -
 * in either direction - with respect to other tokens in the pool. For instance, a stablecoin might de-peg
 * and go to zero. With no safeguards, arbitrageurs could drain the pool by selling large amounts of the
 * token to the pool at inflated internal prices.
 *
 * The circuit breaker mechanism establishes a "safe trading range" for each token, expressed in terms of
 * the BPT price. Both lower and upper bounds can be set, and if a trade would result in moving the BPT price
 * of any token involved in the operation outside that range, the breaker is "tripped", and the operation
 * should revert. Each token is independent, since some might have very "tight" valid trading ranges, such as
 * stablecoins, and others are more volatile.
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
library CircuitBreakerStorageLib {
    using ValueCompression for uint256;
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    // Store circuit breaker information per token
    // When the circuit breaker is set, the caller passes in the lower and upper bounds (expressed as percentages),
    // the current BPT price, and the normalized weight. The weight is bound by 1e18, and fits in ~60 bits, so there
    // is no need for compression. We store the weight in 64 bits, just to use round numbers for all the bit lengths.
    //
    // We then store the current BPT price, and compute and cache the adjusted lower and upper bounds at the current
    // weight. When multiplied by the stored BPT price, the adjusted bounds define the BPT price trading range: the
    // "runtime" BPT prices can be directly compared to these BPT price bounds.
    //
    // Since the price bounds need to be adjusted for the token weight, in general these adjusted bounds would be
    // computed every time. However, if the weight of the token has not changed since the circuit breaker was set,
    // the adjusted bounds cache can still be used, avoiding a heavy computation.
    //
    // [        32 bits       |        32 bits       |  96 bits  |     64 bits      |   16 bits   |   16 bits   |
    // [ adjusted upper bound | adjusted lower bound | BPT price | reference weight | upper bound | lower bound |
    // |MSB                                                                                                  LSB|
    uint256 private constant _LOWER_BOUND_OFFSET = 0;
    uint256 private constant _UPPER_BOUND_OFFSET = _LOWER_BOUND_OFFSET + _BOUND_WIDTH;
    uint256 private constant _REFERENCE_WEIGHT_OFFSET = _UPPER_BOUND_OFFSET + _BOUND_WIDTH;
    uint256 private constant _BPT_PRICE_OFFSET = _REFERENCE_WEIGHT_OFFSET + _REFERENCE_WEIGHT_WIDTH;
    uint256 private constant _ADJUSTED_LOWER_BOUND_OFFSET = _BPT_PRICE_OFFSET + _BPT_PRICE_WIDTH;
    uint256 private constant _ADJUSTED_UPPER_BOUND_OFFSET = _ADJUSTED_LOWER_BOUND_OFFSET + _ADJUSTED_BOUND_WIDTH;

    uint256 private constant _REFERENCE_WEIGHT_WIDTH = 64;
    uint256 private constant _BPT_PRICE_WIDTH = 96;
    uint256 private constant _BOUND_WIDTH = 16;
    uint256 private constant _ADJUSTED_BOUND_WIDTH = 32;

    // We allow the bounds to range over two orders of magnitude: 0.1 - 10. The maximum upper bound is set to 10.0
    // in 18-decimal floating point, since this fits in 64 bits, and can be shifted down to 16 bit precision without
    // much loss. Since compression would lose a lot of precision for values close to 0, we also constrain the lower
    // bound to a minimum value >> 0.
    //
    // Since the adjusted bounds are (bound percentage)**(1 - weight), and weights are stored normalized, the
    // maximum normalized weight is 1 - minimumWeight, which is 0.99 ~ 1. Therefore the adjusted bounds are likewise
    // constrained to 10**1 ~ 10. So we can use this as the maximum value of both the raw percentage and
    // weight-adjusted percentage bounds.
    uint256 private constant _MIN_BOUND_PERCENTAGE = 1e17; // 0.1 in 18-decimal fixed point

    uint256 private constant _MAX_BOUND_PERCENTAGE = 10e18; // 10.0 in 18-decimal fixed point

    // Since we know the bounds fit into 64 bits, simply shifting them down to fit in 16 bits is not only faster than
    // the compression and decompression operations, but generally less lossy.
    uint256 private constant _BOUND_SHIFT_BITS = 64 - _BOUND_WIDTH;

    /**
     * @notice Returns the BPT price, reference weight, and the lower and upper percentage bounds for a given token.
     * @dev If an upper or lower bound value is zero, it means there is no circuit breaker in that direction for the
     * given token.
     * @param circuitBreakerState - The bytes32 state of the token of interest.
     */
    function getCircuitBreakerFields(bytes32 circuitBreakerState)
        internal
        pure
        returns (
            uint256 bptPrice,
            uint256 referenceWeight,
            uint256 lowerBound,
            uint256 upperBound
        )
    {
        bptPrice = circuitBreakerState.decodeUint(_BPT_PRICE_OFFSET, _BPT_PRICE_WIDTH);
        referenceWeight = circuitBreakerState.decodeUint(_REFERENCE_WEIGHT_OFFSET, _REFERENCE_WEIGHT_WIDTH);
        // Decompress the bounds by shifting left.
        lowerBound = circuitBreakerState.decodeUint(_LOWER_BOUND_OFFSET, _BOUND_WIDTH) << _BOUND_SHIFT_BITS;
        upperBound = circuitBreakerState.decodeUint(_UPPER_BOUND_OFFSET, _BOUND_WIDTH) << _BOUND_SHIFT_BITS;
    }

    /**
     * @notice Returns a dynamic lower or upper BPT price bound for a given token, at the current weight.
     * @dev The current BPT price of the token can be directly compared to this value, to determine whether
     * the breaker should be tripped. If a bound is 0, it means there is no circuit breaker in that direction
     * for this token: there might be a lower bound, but no upper bound. If the current BPT price is less than
     * the lower bound, or greater than the non-zero upper bound, the transaction should revert.
     *
     * These BPT price bounds are dynamically adjusted by a non-linear factor dependent on the weight.
     * In general: lower/upper BPT price bound = bptPrice * "weight adjustment". The weight adjustment is
     * given as: (boundaryPercentage)**(1 - weight).
     *
     * For instance, given the 80/20 BAL/WETH pool with a 90% lower bound, the weight complement would be
     * (1 - 0.8) = 0.2, so the lower adjusted bound would be (0.9 ** 0.2) ~ 0.9791. For the WETH token at 20%,
     * the bound would be (0.9 ** 0.8) ~ 0.9192.
     *
     * With unequal weights (assuming a balanced pool), the balance of a higher-weight token will respond less
     * to a proportional change in spot price than a lower weight token, which we might call "balance inertia".
     *
     * If the external price drops, all else being equal, the pool would be arbed until the percent drop in spot
     * price equaled the external price drop. Since during this process the *internal* pool price would be
     * above market, the arbers would sell cheap tokens to our poor unwitting pool at inflated prices, raising
     * the balance of the depreciating token, and lowering the balance of another token (WETH in this example).
     *
     * Using weighted math, and assuming for simplicity that the sum of all weights is 1, you can compute the
     * amountIn ratio for the arb trade as: (1/priceRatio) ** (1 - weight). For our 0.9 ratio and a weight of
     * 0.8, this is ~ 1.0213. So if you had 8000 tokens before, the ending balance would be 8000*1.0213 ~ 8170.
     * Note that the higher the weight, the lower this ratio is. That means the counterparty token is going
     * out proportionally faster than the arb token is coming in: hence the non-linear relationship between
     * spot price and BPT price.
     *
     * If we call the initial balance B0, and set k = (1/priceRatio) ** (1 - weight), the post-arb balance is
     * given by: B1 = k * B0. Since the BPTPrice0 = totalSupply*weight/B0, and BPTPrice1 = totalSupply*weight/B1,
     * we can combine these equations to compute the BPT price ratio BPTPrice1/BPTPrice0 = 1/k; BPT1 = BPT0/k.
     * So we see that the "conversion factor" between the spot price ratio and BPT Price ratio can be written
     * as above BPT1 = BPT0 * (1/k), or more simply: (BPT price) * (priceRatio)**(1 - weight).
     *
     * Another way to think of it is in terms of "BPT Value". Assuming a balanced pool, a token with a weight
     * of 80% represents 80% of the value of the BPT. An uncorrelated drop in that token's value would drop
     * the value of LP shares much faster than a similar drop in the value of a 20% token. Whatever the value
     * of the bound percentage, as the adjustment factor - B ** (1 - weight) - approaches 1, less adjustment
     * is necessary: it tracks the relative price movement more closely. Intuitively, this is wny we use the
     * complement of the weight. Higher weight = lower exponent = adjustment factor closer to 1.0 = "faster"
     * tracking of value changes.
     *
     * If the value of the weight has not changed, we can use the cached adjusted bounds stored when the breaker
     * was set. Otherwise, we need to calculate them.
     *
     * As described in the general comments above, the weight adjustment calculation attempts to isolate changes
     * in the balance due to arbitrageurs responding to external prices, from internal price changes caused by
     * weight changes. There is a non-linear relationship between "spot" price changes and BPT price changes.
     * This calculation transforms one into the other.
     * @param circuitBreakerState - The bytes32 state of the token of interest.
     * @param currentWeight - The token's current normalized weight.
     * @param isLowerBound - Flag indicating whether this is the lower bound.
     * @return - lower or upper bound BPT price, which can be directly compared against the current BPT price.
     */
    function getBptPriceBound(
        bytes32 circuitBreakerState,
        uint256 currentWeight,
        bool isLowerBound
    ) internal pure returns (uint256) {
        uint256 bound = circuitBreakerState.decodeUint(
            isLowerBound ? _LOWER_BOUND_OFFSET : _UPPER_BOUND_OFFSET,
            _BOUND_WIDTH
        ) << _BOUND_SHIFT_BITS;

        if (bound == 0) {
            return 0;
        }
        // Retrieve the BPT price and reference weight passed in when the circuit breaker was set.
        uint256 bptPrice = circuitBreakerState.decodeUint(_BPT_PRICE_OFFSET, _BPT_PRICE_WIDTH);
        uint256 referenceWeight = circuitBreakerState.decodeUint(_REFERENCE_WEIGHT_OFFSET, _REFERENCE_WEIGHT_WIDTH);

        uint256 boundRatio;

        if (currentWeight == referenceWeight) {
            // If the weight hasn't changed since the circuit breaker was set, we can use the precomputed
            // adjusted bounds.
            boundRatio = circuitBreakerState
                .decodeUint(
                isLowerBound ? _ADJUSTED_LOWER_BOUND_OFFSET : _ADJUSTED_UPPER_BOUND_OFFSET,
                _ADJUSTED_BOUND_WIDTH
            )
                .decompress(_ADJUSTED_BOUND_WIDTH, _MAX_BOUND_PERCENTAGE);
        } else {
            // The weight has changed, so we retrieve the raw percentage bounds and do the full calculation.
            // Decompress the bounds by shifting left.
            boundRatio = CircuitBreakerLib.calcAdjustedBound(bound, currentWeight, isLowerBound);
        }

        // Use the adjusted bounds (either cached or computed) to calculate the BPT price bounds.
        return CircuitBreakerLib.calcBptPriceBoundary(boundRatio, bptPrice, isLowerBound);
    }

    /**
     * @notice Sets the reference BPT price, normalized weight, and upper and lower bounds for a token.
     * @dev If a bound is zero, it means there is no circuit breaker in that direction for the given token.
     * @param bptPrice: The BPT price of the token at the time the circuit breaker is set. The BPT Price
     * of a token is generally given by: supply * weight / balance.
     * @param referenceWeight: This is the current normalized weight of the token.
     * @param lowerBound: The value of the lower bound, expressed as a percentage.
     * @param upperBound: The value of the upper bound, expressed as a percentage.
     */
    function setCircuitBreaker(
        uint256 bptPrice,
        uint256 referenceWeight,
        uint256 lowerBound,
        uint256 upperBound
    ) internal pure returns (bytes32) {
        // It's theoretically not required for the lower bound to be < 1, but it wouldn't make much sense otherwise:
        // the circuit breaker would immediately trip. Note that this explicitly allows setting either to 0, disabling
        // the circuit breaker for the token in that direction.
        _require(
            lowerBound == 0 || (lowerBound >= _MIN_BOUND_PERCENTAGE && lowerBound <= FixedPoint.ONE),
            Errors.INVALID_CIRCUIT_BREAKER_BOUNDS
        );
        _require(upperBound <= _MAX_BOUND_PERCENTAGE, Errors.INVALID_CIRCUIT_BREAKER_BOUNDS);
        _require(upperBound == 0 || upperBound >= lowerBound, Errors.INVALID_CIRCUIT_BREAKER_BOUNDS);

        // Set the reference parameters: BPT price of the token, and the reference weight.
        bytes32 circuitBreakerState = bytes32(0).insertUint(bptPrice, _BPT_PRICE_OFFSET, _BPT_PRICE_WIDTH).insertUint(
            referenceWeight,
            _REFERENCE_WEIGHT_OFFSET,
            _REFERENCE_WEIGHT_WIDTH
        );

        // Add the lower and upper percentage bounds. Compress by shifting right.
        circuitBreakerState = circuitBreakerState
            .insertUint(lowerBound >> _BOUND_SHIFT_BITS, _LOWER_BOUND_OFFSET, _BOUND_WIDTH)
            .insertUint(upperBound >> _BOUND_SHIFT_BITS, _UPPER_BOUND_OFFSET, _BOUND_WIDTH);

        // Precompute and store the adjusted bounds, used to convert percentage bounds to BPT price bounds.
        // If the weight has not changed since the breaker was set, we can use the precomputed values directly,
        // and avoid a heavy computation.
        uint256 adjustedLowerBound = CircuitBreakerLib.calcAdjustedBound(lowerBound, referenceWeight, true);
        uint256 adjustedUpperBound = CircuitBreakerLib.calcAdjustedBound(upperBound, referenceWeight, false);

        // Finally, insert these computed adjusted bounds, and return the complete set of fields.
        return
            circuitBreakerState
                .insertUint(
                adjustedLowerBound.compress(_ADJUSTED_BOUND_WIDTH, _MAX_BOUND_PERCENTAGE),
                _ADJUSTED_LOWER_BOUND_OFFSET,
                _ADJUSTED_BOUND_WIDTH
            )
                .insertUint(
                adjustedUpperBound.compress(_ADJUSTED_BOUND_WIDTH, _MAX_BOUND_PERCENTAGE),
                _ADJUSTED_UPPER_BOUND_OFFSET,
                _ADJUSTED_BOUND_WIDTH
            );
    }

    /**
     * @notice Update the cached adjusted bounds, given a new weight.
     * @dev This might be used when weights are adjusted, pre-emptively updating the cache to improve performance
     * of operations after the weight change completes. Note that this does not update the BPT price: this is still
     * relative to the last call to `setCircuitBreaker`. The intent is only to optimize the automatic bounds
     * adjustments due to changing weights.
     */
    function updateAdjustedBounds(bytes32 circuitBreakerState, uint256 newReferenceWeight)
        internal
        pure
        returns (bytes32)
    {
        uint256 adjustedLowerBound = CircuitBreakerLib.calcAdjustedBound(
            circuitBreakerState.decodeUint(_LOWER_BOUND_OFFSET, _BOUND_WIDTH) << _BOUND_SHIFT_BITS,
            newReferenceWeight,
            true
        );
        uint256 adjustedUpperBound = CircuitBreakerLib.calcAdjustedBound(
            circuitBreakerState.decodeUint(_UPPER_BOUND_OFFSET, _BOUND_WIDTH) << _BOUND_SHIFT_BITS,
            newReferenceWeight,
            false
        );

        // Replace the reference weight.
        bytes32 result = circuitBreakerState.insertUint(
            newReferenceWeight,
            _REFERENCE_WEIGHT_OFFSET,
            _REFERENCE_WEIGHT_WIDTH
        );

        // Update the cached adjusted bounds.
        return
            result
                .insertUint(
                adjustedLowerBound.compress(_ADJUSTED_BOUND_WIDTH, _MAX_BOUND_PERCENTAGE),
                _ADJUSTED_LOWER_BOUND_OFFSET,
                _ADJUSTED_BOUND_WIDTH
            )
                .insertUint(
                adjustedUpperBound.compress(_ADJUSTED_BOUND_WIDTH, _MAX_BOUND_PERCENTAGE),
                _ADJUSTED_UPPER_BOUND_OFFSET,
                _ADJUSTED_BOUND_WIDTH
            );
    }
}
