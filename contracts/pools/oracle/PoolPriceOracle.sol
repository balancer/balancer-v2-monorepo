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

import "./Buffer.sol";
import "./Samples.sol";
import "../../lib/helpers/BalancerErrors.sol";

/**
 * @dev This module provides a simple interface to allow pools to give access to historic pricing information.
 * In particular it works with a circular buffer of 1024 slots (samples) guaranteeing that each of these samples
 * will not accumulate information for more than 2 consecutive minutes. Therefore, assuming the worst case where a
 * sample is updated on each block, the largest period that will be covered by the buffer is ≈ 34 hours.
 */
contract PoolPriceOracle {
    using Buffer for uint256;
    using Samples for bytes32;

    // Each sample in the buffer will accumulate information for up-to 2 minutes
    uint256 private constant _MAX_SAMPLE_DURATION = 2 minutes;

    // We use a mapping to simulate an array: the buffer won't grow or shrink, and since we will always use valid
    // indexes using a mapping saves gas by skipping the bounds checks.
    mapping(uint256 => bytes32) internal _samples;

    /**
     * @dev Processes new price and invariant data, updating the current sample or creating a new one.
     *
     * Receives the new logarithms of values to store: `logPairPrice`, `logBptPrice` and `logInvariant`, as well the
     * index of the current sample, and the timestamp of its creation.
     *
     * The return value of `newSample` is true if a new sample was created, in which case `sampleIndex` is its index.
     */
    function _processPriceData(
        uint256 currentSampleInitialTimestamp,
        uint256 currentIndex,
        int256 logPairPrice,
        int256 logBptPrice,
        int256 logInvariant
    ) internal returns (uint256 sampleIndex) {
        // solhint-disable not-rely-on-time
        // Read current sample and update it with the newly received data.
        bytes32 sample = _sample(currentIndex).update(logPairPrice, logBptPrice, logInvariant, block.timestamp);

        // We create a new sample if more than _MAX_SAMPLE_DURATION seconds have elapsed since the creation of the
        // current one. In other words, no sample accumulates data over a period larger than _MAX_SAMPLE_DURATION.
        bool newSample = block.timestamp - currentSampleInitialTimestamp >= _MAX_SAMPLE_DURATION;
        sampleIndex = newSample ? currentIndex.next() : currentIndex;

        // Store the updated or new sample.
        _samples[sampleIndex] = sample;
    }

    /**
     * @dev Returns the log pair price of a sample at a specific index of the buffer
     */
    function _getLogPairPrice(uint256 index) internal view returns (int256) {
        return _sample(index).logPairPrice();
    }

    /**
     * @dev Tells the accumulated value of a specific variable `_seconds` ago.
     * It assumes `currentIndex` is the index of the latest sample in the buffer.
     *
     * In case the target timestamp does not reach the timestamp of the latest sample, it answers using the accumulated
     * value of the latest sample.
     *
     * In case the target timestamp is older than the timestamp of the latest sample, there are a few requirements:
     *  - The oldest timestamp cannot be zero, meaning the buffer must be fully initialized, otherwise it reverts.
     *  - It cannot be older than the oldest timestamp, in that case it reverts.
     * If these requirements are met, it performs a binary search to use the accumulated value of the nearest sample
     * to the target timestamp.
     */
    function _getPastAccLogPairPrice(uint256 currentIndex, uint256 _seconds) internal view returns (int256) {
        // Make sure the given number of seconds refers to a reasonable date.
        _require(block.timestamp >= _seconds, Errors.ORACLE_INVALID_SECONDS_QUERY);
        uint256 lookUpTime = block.timestamp - _seconds;

        // In case there is no timestamp stored in the current index, it means the buffer has not been initialized yet,
        // meaning there is no information available to answer the query.
        bytes32 sample = _sample(currentIndex);
        uint256 latestTimestamp = sample.timestamp();
        _require(latestTimestamp > 0, Errors.ORACLE_NOT_INITIALIZED);

        if (latestTimestamp <= lookUpTime) {
            // In case the desired date is ahead the latest sample, we compute the corresponding accumulated value
            // that applies for that period of time.
            uint256 elapsed = lookUpTime - latestTimestamp;
            return sample.accLogPairPrice() + (sample.logPairPrice() * int256(elapsed));
        } else {
            // The oldest sample is always the following sample in the circular buffer to the latest sample.
            uint256 oldestIndex = currentIndex.next();
            bytes32 oldestSample = _sample(oldestIndex);
            uint256 oldestTimestamp = oldestSample.timestamp();

            // Check the buffer is fully initialized and that the target is not older than the oldest timestamp.
            _require(oldestTimestamp > 0, Errors.ORACLE_NOT_INITIALIZED);
            _require(oldestTimestamp <= lookUpTime, Errors.ORACLE_QUERY_TOO_OLD);

            // Perform binary search to find nearest samples to the desired timestamp.
            (bytes32 prev, bytes32 next) = _findNearestSample(lookUpTime, oldestIndex);
            uint256 samplesTimeDiff = next.timestamp() - prev.timestamp();
            if (samplesTimeDiff == 0) {
                // It matched exactly one of the samples in the buffer.
                return prev.accLogPairPrice();
            } else {
                // Estimate the accumulated value based on the elapsed time from the previous sample to the one
                // required. We know there will be at least one since we already check the target timestamp is not
                // older than the oldest sample.
                uint256 elapsed = lookUpTime - prev.timestamp();
                int256 samplesAccDiff = next.accLogPairPrice() - prev.accLogPairPrice();
                return prev.accLogPairPrice() + ((samplesAccDiff * int256(elapsed)) / int256(samplesTimeDiff));
            }
        }
    }

    /**
     * @dev Finds the nearest sample based on a target date using a binary search.
     * Since the samples buffer is not sorted and this is mandatory to for this type of search, the user is required
     * to tell an `offset`, which is the index in the buffer with the oldest sample.
     */
    function _findNearestSample(uint256 lookUpDate, uint256 offset) internal view returns (bytes32 prev, bytes32 next) {
        uint256 mid;
        bytes32 sample;
        uint256 sampleTimestamp;

        uint256 low = 0;
        uint256 high = Buffer.SIZE - 1;

        while (low <= high) {
            // Compute mid index taking the floor
            uint256 midWithoutOffset = (high + low) / 2;
            mid = midWithoutOffset.add(offset);
            sample = _sample(mid);
            sampleTimestamp = sample.timestamp();

            if (sampleTimestamp < lookUpDate) {
                // If the mid sample is bellow the look up date, then increase the low index to start from there
                low = midWithoutOffset + 1;
            } else if (sampleTimestamp > lookUpDate) {
                // If the mid sample is above the look up date, then decrease the high index to start from there
                // No need for SafeMath as by definition high > low >= 0, meaning high >= 1, therefore mid >= 1
                // Once high hits 0, the while condition won't be met exiting the loop
                high = midWithoutOffset - 1;
            } else {
                // sampleTimestamp == lookUpDate
                // Return sample if it match exactly the date we were looking for
                return (sample, sample);
            }
        }

        // In case we reach here, it means we didn't find exactly the sample we where looking for.
        return sampleTimestamp < lookUpDate ? (sample, _sample(mid.next())) : (_sample(mid.prev()), sample);
    }

    /**
     * @dev Tells the sample at a given index in the buffer
     */
    function _sample(uint256 index) private view returns (bytes32) {
        return _samples[index];
    }
}
