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

/**
 * @dev This library provides a few functions to help manipulating samples for Pool Price Oracles.
 * It basically handles the updates, encoding, and decoding of samples.
 *
 * Each sample holds 7 pieces of information:
 *  1. Log pair price: The logarithmic value of the sample's pair price reported to the oracle.
 *  2. Acc log pair price: The sum of all the log pair prices reported to the oracle multiplied by the elapsed time
 *     since the previous value accumulated in the sample.
 *  3. Log BPT price: The logarithmic value of the sample's BPT price reported to the oracle.
 *  4. Acc log BPT price: The sum of all the log BPT prices reported to the oracle multiplied by the elapsed time
 *     since the previous value accumulated in the sample.
 *  5. Log invariant: The logarithmic value of the sample's invariant reported to the oracle.
 *  6. Acc log invariant: The sum of all the log invariants reported to the oracle multiplied by the elapsed time
 *     since the previous value accumulated in the sample.
 *  7. Timestamp: The latest time when the sample was updated
 *
 * All samples are stored in a single word, represented by a bytes32, with the following structure:
 *
 * [ log pair price | acc log pair price | log bpt price | acc log bpt price |  log inv  | acc log inv |  timestamp ]
 * [     int20      |        int54       |     int20     |       int54       |   int20   |    int54    |    uint32  ]
 *
 * Note we are only using the least-significant 254 bytes of a word: we ignore the most-significant 2 bytes.
 */
library Samples {
    using WordCodec for int256;
    using WordCodec for uint256;
    using WordCodec for bytes32;

    /**
     * @dev Updates a sample, accumulating the new reported information based on the elapsed time since the previous
     * sample update and setting the current timestamp.
     *
     * IMPORTANT: This function does not perform any arithmetic checks. It assumes the caller will never report a value
     * that doesn't fit, or that will cause accumulators to overflow. Additionally, it also assumes the current
     * timestamp reported will be always in the future, meaning it cannot be lower than the timestamp already stored
     * in the sample to be updated.
     */
    function update(
        bytes32 sample,
        int256 logPairPrice,
        int256 logBptPrice,
        int256 logInvariant,
        uint256 currentTimestamp
    ) internal pure returns (bytes32) {
        // We assume the current timestamp fits in an int32 which will hold until year 2038
        int256 elapsed = int256(currentTimestamp - timestamp(sample));
        int256 newAccLogPairPrice = accLogPairPrice(sample) + logPairPrice * elapsed;
        int256 newAccLogBptPrice = accLogBptPrice(sample) + logBptPrice * elapsed;
        int256 newAccLogInvariant = accLogInvariant(sample) + logInvariant * elapsed;
        return
            pack(
                logPairPrice,
                newAccLogPairPrice,
                logBptPrice,
                newAccLogBptPrice,
                logInvariant,
                newAccLogInvariant,
                currentTimestamp
            );
    }

    /**
     * @dev Returns the logarithm of a sample's pair price.
     */
    function logPairPrice(bytes32 sample) internal pure returns (int256) {
        return sample.decodeInt20(234); // 234 = 54 + 20 + 54 + 20 + 54 + 32
    }

    /**
     * @dev Returns a sample's time-weighted accumulated pair price logarithm.
     */
    function accLogPairPrice(bytes32 sample) internal pure returns (int256) {
        return sample.decodeInt54(180); // 180 = 20 + 54 + 20 + 54 + 32
    }

    /**
     * @dev Returns the logarithm of a sample's BPT price.
     */
    function logBptPrice(bytes32 sample) internal pure returns (int256) {
        return sample.decodeInt20(160); // 160 = 54 + 20 + 54 + 32
    }

    /**
     * @dev Returns a sample's time-weighted accumulated BPT price logarithm.
     */
    function accLogBptPrice(bytes32 sample) internal pure returns (int256) {
        return sample.decodeInt54(106); // 106 = 20 + 54 + 32
    }

    /**
     * @dev Returns the logarithm of a sample's invariant
     */
    function logInvariant(bytes32 sample) internal pure returns (int256) {
        return sample.decodeInt20(86); // 86 = 54 + 32
    }

    /**
     * @dev Returns a sample's time-weighted accumulated invariant logarithm.
     */
    function accLogInvariant(bytes32 sample) internal pure returns (int256) {
        return sample.decodeInt54(32);
    }

    /**
     * @dev Tells the timestamp encoded in a sample
     */
    function timestamp(bytes32 sample) internal pure returns (uint256) {
        return sample.decodeUint32(0);
    }

    /**
     * @dev Packs together the different pieces of information to construct a sample, represented using a bytes32.
     */
    function pack(
        int256 _logPairPrice,
        int256 _accLogPairPrice,
        int256 _logBptPrice,
        int256 _accLogBptPrice,
        int256 _logInvariant,
        int256 _accLogInvariant,
        uint256 _timestamp
    ) internal pure returns (bytes32) {
        return bytes32(
            uint256(_logPairPrice << 234) +
            uint256(_accLogPairPrice << 180) +
            uint256(_logBptPrice << 160) +
            uint256(_accLogBptPrice << 106) +
            uint256(_logInvariant << 86) +
            uint256(_accLogInvariant << 32) +
            _timestamp
        );
    }
}
