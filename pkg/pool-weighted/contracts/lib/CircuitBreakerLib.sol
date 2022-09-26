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
    // [      24 bits      |      24 bits      |  112 bits |   64 bits    |   16 bits   |   16 bits   |
    // [ upper bound ratio | lower bound ratio | BPT price | weight comp. | upper bound | lower bound |
    // |MSB                                                                                        LSB|
    uint256 private constant _LOWER_BOUND_OFFSET = 0;
    uint256 private constant _UPPER_BOUND_OFFSET = _LOWER_BOUND_OFFSET + _BOUND_WIDTH;
    uint256 private constant _WEIGHT_COMPLEMENT_OFFSET = _UPPER_BOUND_OFFSET + _BOUND_WIDTH;
    uint256 private constant _BPT_PRICE_OFFSET = _WEIGHT_COMPLEMENT_OFFSET + _WEIGHT_COMPLEMENT_WIDTH;
    uint256 private constant _LOWER_BOUND_RATIO_OFFSET = _BPT_PRICE_OFFSET + _BPT_PRICE_WIDTH;
    uint256 private constant _UPPER_BOUND_RATIO_OFFSET = _LOWER_BOUND_RATIO_OFFSET + _BOUND_RATIO_WIDTH;

    uint256 private constant _WEIGHT_COMPLEMENT_WIDTH = 64;
    uint256 private constant _BPT_PRICE_WIDTH = 112;
    uint256 private constant _BOUND_WIDTH = 16;
    uint256 private constant _BOUND_RATIO_WIDTH = 24;

    // We compress the ratios from a range of [0, 10e18], chosen to allow the upper bound to exceed 1.
    // For consistency, use the same max value to compress the lower bound, even though we expect it to be less than 1.
    uint256 private constant _MAX_BOUND_PERCENTAGE = 10e18; // 10.0 in 18 decimal fixed point

    /**
     * @notice Returns the BPT price and weight complement values, and lower and upper bounds for a given token.
     * @dev If an upper or lower bound value is zero, it means there is no circuit breaker in that direction for the
     * given token.
     * @param circuitBreakerState - The bytes32 state of the token of interest.
     */
    function getCircuitBreakerFields(bytes32 circuitBreakerState) internal pure returns (CircuitBreakerParams memory) {
        return
            CircuitBreakerParams({
                bptPrice: circuitBreakerState.decodeUint(_BPT_PRICE_OFFSET, _BPT_PRICE_WIDTH),
                weightComplement: circuitBreakerState.decodeUint(_WEIGHT_COMPLEMENT_OFFSET, _WEIGHT_COMPLEMENT_WIDTH),
                lowerBound: circuitBreakerState.decodeUint(_LOWER_BOUND_OFFSET, _BOUND_WIDTH).decompress(
                    _BOUND_WIDTH,
                    _MAX_BOUND_PERCENTAGE
                ),
                upperBound: circuitBreakerState.decodeUint(_UPPER_BOUND_OFFSET, _BOUND_WIDTH).decompress(
                    _BOUND_WIDTH,
                    _MAX_BOUND_PERCENTAGE
                )
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
     * lower/upper BPT price bound = bptPrice * "conversion ratio". The conversion ratio is given as
     * (boundaryPercentage)**(weightComplement).
     *
     * For instance, given the 80/20 BAL/WETH pool with a 90% lower bound, the weight complement would be
     * (1 - 0.8) = 0.2, so the lower BPT price bound conversion ratio would be (0.9 ** 0.2) ~ 0.9791.
     * Intuitively, if you had a 50/50 pool with equal balances, the spot price and BPT price would move
     * together: a 20% drop in spot price would correspond to a 20% drop in BPT price.
     *
     * But with unequal weights (assuming a balance pool), the balance of a higher-weight token will respond less
     * to a proportional change in spot price than a lower weight token. In the simulations, Integrations
     * coined the term "balance inertia".
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
     * as above BPT1 = BPT0 * (1/k), or more simply: (reference BPT price) * (priceRatio)**(1 - weight).
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
     * @param currentWeightComplement - The complement of this token's weight, generally given by (1 - weight).
     * @return - lower and upper BPT price bounds, which can be directly compared against the current BPT price.
     */
    function getCurrentCircuitBreakerBounds(bytes32 circuitBreakerState, uint256 currentWeightComplement)
        internal
        pure
        returns (uint256, uint256)
    {
        uint256 bptPrice = circuitBreakerState.decodeUint(_BPT_PRICE_OFFSET, _BPT_PRICE_WIDTH);
        uint256 weightComplement = circuitBreakerState.decodeUint(_WEIGHT_COMPLEMENT_OFFSET, _WEIGHT_COMPLEMENT_WIDTH);

        uint256 lowerBoundRatio;
        uint256 upperBoundRatio;

        if (weightComplement == currentWeightComplement) {
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
            // retrieve the raw percentage bounds and do the full calculation.
            (lowerBoundRatio, upperBoundRatio) = getBoundaryConversionRatios(
                circuitBreakerState.decodeUint(_LOWER_BOUND_OFFSET, _BOUND_WIDTH).decompress(
                    _BOUND_WIDTH,
                    _MAX_BOUND_PERCENTAGE
                ),
                circuitBreakerState.decodeUint(_UPPER_BOUND_OFFSET, _BOUND_WIDTH).decompress(
                    _BOUND_WIDTH,
                    _MAX_BOUND_PERCENTAGE
                ),
                currentWeightComplement
            );
        }

        // Use the ratios retrieved (or computed) above to convert raw percentage bounds to BPT price bounds.
        // To err in favor of tripping the breaker, round the lower bound up, and the upper bound down.
        return (bptPrice.mulUp(lowerBoundRatio), bptPrice.mulDown(upperBoundRatio));
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

        // Add the lower and upper percentage bounds.
        circuitBreakerState = circuitBreakerState
            .insertUint(
            params.lowerBound.compress(_BOUND_WIDTH, _MAX_BOUND_PERCENTAGE),
            _LOWER_BOUND_OFFSET,
            _BOUND_WIDTH
        )
            .insertUint(
            params.upperBound.compress(_BOUND_WIDTH, _MAX_BOUND_PERCENTAGE),
            _UPPER_BOUND_OFFSET,
            _BOUND_WIDTH
        );

        // Precompute and store the conversion ratios, used to convert percentage bounds to BPT price bounds.
        // If the weight complement has not changed since the breaker was set (i.e., if there is no ongoing weight
        // update, and no tokens have been added or removed), we can use the precomputed values directly, and avoid
        // a heavy computation.
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
        uint256 currentWeightComplement
    ) internal pure returns (uint256 lowerBoundRatio, uint256 upperBoundRatio) {
        // Rounding down for the lower bound, and up for the upper bound will maximize the
        // "operating range" - the BPT price range that will not trigger the circuit breaker -
        // of the pool for traders.
        lowerBoundRatio = lowerBound.powDown(currentWeightComplement);
        upperBoundRatio = upperBound.powUp(currentWeightComplement);
    }
}
