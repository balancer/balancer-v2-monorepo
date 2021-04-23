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

/**
 * @dev This library provides a few functions to help manipulating samples for Pool Price Oracles.
 * It basically handles the updates, encoding, and decoding of samples.
 *
 * Each sample holds 7 pieces of information:
 *  1. Last log pair price: The logarithmic value of the last pair price reported to the oracle.
 *  2. Acc log pair price: The sum of all the log pair prices reported to the oracle multiplied by the elapsed time
 *     since the previous value accumulated in the sample.
 *  3. Last log BPT price: The logarithmic value of the last BPT price reported to the oracle.
 *  4. Acc log BPT price: The sum of all the log BPT prices reported to the oracle multiplied by the elapsed time
 *     since the previous value accumulated in the sample.
 *  5. Last log invariant: The logarithmic value of the last invariant reported to the oracle.
 *  6. Acc log invariant: The sum of all the log invariants reported to the oracle multiplied by the elapsed time
 *     since the previous value accumulated in the sample.
 *  7. Timestamp: The latest time when the sample was updated
 *
 * All samples are stored in a single word, represented by a bytes32, following the next structure:
 *
 * [ last log pair | acc log pair | last log bpt | acc log bpt | last log inv | acc log inv |  timestamp ]
 * [     int20     |     int54    |     int20    |     int54   |     int20    |    int54    |    uint32  ]
 *
 * Note we are only using the least-significant 254 bytes of a word: we ignore the most-significant 2 bytes.
 */
library Samples {
    // These mask and constants are used to pack and unpack the different pieces of information stored in a sample.
    uint256 private constant _MASK_32 = 2**(32) - 1;
    int256 private constant _MASK_20 = 2**(20) - 1;
    int256 private constant _MASK_54 = 2**(54) - 1;
    int256 private constant _MAX_INT_20 = 2**(19) - 1;
    int256 private constant _MAX_INT_54 = 2**(53) - 1;

    /**
     * @dev Updates a sample, accumulating the new reported information based on the elapsed time since the previous
     * sample update and setting the current timestamp.
     *
     * IMPORTANT! This function does not perform any arithmetic checks. It assumes the caller will never report a value
     * that will make the accumulators to overflow. Additionally, it also assumes the current timestamp reported will be
     * always in the future, meaning it cannot be lower than the timestamp already stored in the sample to be updated.
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
     * @dev Returns the logarithm of a sample's instant pair price.
     */
    function lastLogPairPrice(bytes32 sample) internal pure returns (int256) {
        return _decodeInt20(sample, 234); // 234 = 54 + 20 + 54 + 20 + 54 + 32
    }

    /**
     * @dev Returns a sample's time-weighted accumulated pair price logarithm.
     */
    function accLogPairPrice(bytes32 sample) internal pure returns (int256) {
        return _decodeInt54(sample, 180); // 180 = 20 + 54 + 20 + 54 + 32
    }

    /**
     * @dev Tells the last log BPT price encoded in a sample
     */
    function lastLogBptPrice(bytes32 sample) internal pure returns (int256) {
        return _decodeInt20(sample, 160);  // 160 = 54 + 20 + 54 + 32
    }

    /**
     * @dev Tells the accumulated log BPT price encoded in a sample
     */
    function accLogBptPrice(bytes32 sample) internal pure returns (int256) {
        return _decodeInt54(sample, 106); // 106 = 20 + 54 + 32
    }

    /**
     * @dev Tells the last log invariant encoded in a sample
     */
    function lastLogInvariant(bytes32 sample) internal pure returns (int256) {
        return _decodeInt20(sample, 86); // 86 = 54 + 32
    }

    /**
     * @dev Tells the accumulated log invariant encoded in a sample
     */
    function accLogInvariant(bytes32 sample) internal pure returns (int256) {
        return _decodeInt54(sample, 32);
    }

    /**
     * @dev Tells the timestamp encoded in a sample
     */
    function timestamp(bytes32 sample) internal pure returns (uint256) {
        return uint256(sample) & _MASK_32;
    }

    /**
     * @dev Packs together the different pieces of information to construct a sample, represented using a bytes32.
     */
    function pack(
        int256 _lastLogPairPrice,
        int256 _accLogPairPrice,
        int256 _lastLogBptPrice,
        int256 _accLogBptPrice,
        int256 _lastLogInvariant,
        int256 _accLogInvariant,
        uint256 _timestamp
    ) internal pure returns (bytes32) {
        return
            bytes32(
                (uint256(_lastLogPairPrice & _MASK_20) << 234) +
                    (uint256(_accLogPairPrice & _MASK_54) << 180) +
                    (uint256(_lastLogBptPrice & _MASK_20) << 160) +
                    (uint256(_accLogBptPrice & _MASK_54) << 106) +
                    (uint256(_lastLogInvariant & _MASK_20) << 86) +
                    (uint256(_accLogInvariant & _MASK_54) << 32) +
                    (uint256(_timestamp & _MASK_32))
            );
    }

    /**
     * @dev Decodes a 20-bit signed integer from a sample discarding a number of least-significant bits.
     */
    function _decodeInt20(bytes32 sample, uint256 discard) private pure returns (int256) {
        int256 value = int256(sample >> discard) & _MASK_20;
        // In case the decoded value is greater than the max positive integer that can be represented with 20 bits,
        // we know it was originally a negative integer. Therefore, we mask it to restore the sign in the 256 bits
        // representation.
        return value > _MAX_INT_20 ? (value | ~_MASK_20) : value;
    }

    /**
     * @dev Decodes a 54-bits signed integer from a sample discarding a number of least-significant bits.
     */
    function _decodeInt54(bytes32 sample, uint256 discard) private pure returns (int256) {
        int256 value = int256(sample >> discard) & _MASK_54;
        // In case the decoded value is greater than the max positive integer that can be represented with 54 bits,
        // we know it was originally a negative integer. Therefore, we mask it to restore the sign in the 256 bits
        // representation.
        return value > _MAX_INT_54 ? (value | ~_MASK_54) : value;
    }
}
