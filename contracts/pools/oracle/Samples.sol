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

import "../../lib/helpers/WordCodec.sol";
import "../IPoolPriceOracle.sol";

/**
 * @dev This library provides functions to help manipulating samples for Pool Price Oracles. It handles updates,
 * encoding, and decoding of samples.
 *
 * Each sample holds the timestamp of its last update, plus information about three pieces of data: the price pair, the
 * price of BPT (the associated Pool token), and the invariant.
 *
 * Prices and invariant are not stored directly: instead, we store their logarithm. These are known as the 'instant'
 * values: the exact value at that timestamp.
 *
 * Additionally, for each value we keep an accumulator with the sum of all past values, each weighted by the time
 * elapsed since the previous update. This lets us later subtract accumulators at different points in time and divide by
 * the time elapsed between them, arriving at the geometric mean of the values (also known as log-average).
 *
 * All samples are stored in a single 256 bit word with the following structure:
 *
 * [    log pair price     |        bpt price      |       invariant       ]
 * [ instant | accumulator | instant | accumulator | instant | accumulator |  timestamp ]
 * [  int22  |    int53    |  int22  |    int53    |  int22  |    int53    |    uint31  ]
 * MSB                                                                                LSB
 *
 * Assuming the timestamp doesn't overflow (which holds until the year 2038), the largest elapsed time is 2^31, which
 * means the largest possible accumulator value is 2^21 * 2^31, which can be represented using a signed 53 bit integer.
 */
library Samples {
    using WordCodec for int256;
    using WordCodec for uint256;
    using WordCodec for bytes32;

    /**
     * @dev Updates a sample, accumulating the new data based on the elapsed time since the previous update. Returns the
     * updated sample.
     *
     * IMPORTANT: This function does not perform any arithmetic checks. In particular, it assumes the caller will never
     * pass values that cannot be represented as 22 bit signed integers. Additionally, it also assumes
     * `currentTimestamp` is greater than `sample`'s timestamp.
     */
    function update(
        bytes32 sample,
        int256 instLogPairPrice,
        int256 instLogBptPrice,
        int256 instLogInvariant,
        uint256 currentTimestamp
    ) internal pure returns (bytes32) {
        // Because elapsed can be represented as a 31 bit unsigned integer, and the received values can be represented
        // as 22 bit signed integers, we don't need to perform checked arithmetic.

        int256 elapsed = int256(currentTimestamp - timestamp(sample));
        int256 accLogPairPrice = _accLogPairPrice(sample) + instLogPairPrice * elapsed;
        int256 accLogBptPrice = _accLogBptPrice(sample) + instLogBptPrice * elapsed;
        int256 accLogInvariant = _accLogInvariant(sample) + instLogInvariant * elapsed;

        return
            pack(
                instLogPairPrice,
                accLogPairPrice,
                instLogBptPrice,
                accLogBptPrice,
                instLogInvariant,
                accLogInvariant,
                currentTimestamp
            );
    }

    /**
     * @dev Returns the instant value stored in `sample` for `variable`.
     */
    function instant(bytes32 sample, IPoolPriceOracle.Variable variable) internal pure returns (int256) {
        if (variable == IPoolPriceOracle.Variable.PAIR_PRICE) {
            return _instLogPairPrice(sample);
        } else if (variable == IPoolPriceOracle.Variable.BPT_PRICE) {
            return _instLogBptPrice(sample);
        } else {
            // variable == IPoolPriceOracle.Variable.INVARIANT
            return _instLogInvariant(sample);
        }
    }

    /**
     * @dev Returns the accumulator value stored in `sample` for `variable`.
     */
    function accumulator(bytes32 sample, IPoolPriceOracle.Variable variable) internal pure returns (int256) {
        if (variable == IPoolPriceOracle.Variable.PAIR_PRICE) {
            return _accLogPairPrice(sample);
        } else if (variable == IPoolPriceOracle.Variable.BPT_PRICE) {
            return _accLogBptPrice(sample);
        } else {
            // variable == IPoolPriceOracle.Variable.INVARIANT
            return _accLogInvariant(sample);
        }
    }

    /**
     * @dev Returns `sample`'s timestamp.
     */
    function timestamp(bytes32 sample) internal pure returns (uint256) {
        return sample.decodeUint31(0);
    }

    /**
     * @dev Returns `sample`'s instant value for the logarithm of the pair price.
     */
    function _instLogPairPrice(bytes32 sample) private pure returns (int256) {
        return sample.decodeInt22(234); // 234 = 53 + 22 + 53 + 22 + 53 + 31
    }

    /**
     * @dev Returns `sample`'s accumulator of the the logarithm of the pair price.
     */
    function _accLogPairPrice(bytes32 sample) private pure returns (int256) {
        return sample.decodeInt53(181); // 181 = 22 + 53 + 22 + 53 + 31
    }

    /**
     * @dev Returns `sample`'s instant value for the logarithm of the BPT price.
     */
    function _instLogBptPrice(bytes32 sample) private pure returns (int256) {
        return sample.decodeInt22(159); // 159 = 53 + 22 + 53 + 31
    }

    /**
     * @dev Returns `sample`'s accumulator of the the logarithm of the BPT price.
     */
    function _accLogBptPrice(bytes32 sample) private pure returns (int256) {
        return sample.decodeInt53(106); // 106 = 22 + 53 + 31
    }

    /**
     * @dev Returns `sample`'s instant value for the logarithm of the invariant.
     */
    function _instLogInvariant(bytes32 sample) private pure returns (int256) {
        return sample.decodeInt22(84); // 84 = 53 + 31
    }

    /**
     * @dev Returns `sample`'s accumulator of the the logarithm of the invariant.
     */
    function _accLogInvariant(bytes32 sample) private pure returns (int256) {
        return sample.decodeInt53(31);
    }

    /**
     * @dev Returns a sample created by packing together its components.
     */
    function pack(
        int256 instLogPairPrice,
        int256 accLogPairPrice,
        int256 instLogBptPrice,
        int256 accLogBptPrice,
        int256 instLogInvariant,
        int256 accLogInvariant,
        uint256 _timestamp
    ) internal pure returns (bytes32) {
        return
            instLogPairPrice.encodeInt22(234) |
            accLogPairPrice.encodeInt53(181) |
            instLogBptPrice.encodeInt22(159) |
            accLogBptPrice.encodeInt53(106) |
            instLogInvariant.encodeInt22(84) |
            accLogInvariant.encodeInt53(31) |
            _timestamp.encodeUint31(0);
    }
}
