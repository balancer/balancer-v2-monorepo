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

import "./IWeightedPoolPriceOracle.sol";
import "../IPriceOracle.sol";

/**
 * @dev This module allows Pools to access historical pricing information.
 *
 * It uses a 1024 long circular buffer to store past data, where the data whitin each sample is the result of
 * accumulating live data for no more than two minutes. Therefore, assuming the worst case scenario where new data is
 * updated in every single block block, the oldest samples in the buffer (and therefore largest queriable period) will
 * be slightly over 34 hours old.
 *
 * Usage of this module requires the caller to keep track of two variables: the latest circular buffer index, and the
 * timestamp when the index last changed.
 */
contract PoolPriceOracle is IWeightedPoolPriceOracle {
    using Buffer for uint256;
    using Samples for bytes32;

    // Each sample in the buffer accumulates information for up to 2 minutes. This is simply to reduce the size of the
    // buffer: small time deviations will not have any significant effect.
    // solhint-disable not-rely-on-time
    uint256 private constant _MAX_SAMPLE_DURATION = 2 minutes;

    // We use a mapping to simulate an array: the buffer won't grow or shrink, and since we will always use valid
    // indexes using a mapping saves gas by skipping the bounds checks.
    mapping(uint256 => bytes32) internal _samples;

    function getSample(uint256 index)
        external
        view
        override
        returns (
            int256 logPairPrice,
            int256 accLogPairPrice,
            int256 logBptPrice,
            int256 accLogBptPrice,
            int256 logInvariant,
            int256 accLogInvariant,
            uint256 timestamp
        )
    {
        _require(index < Buffer.SIZE, Errors.ORACLE_INVALID_INDEX);

        bytes32 sample = _getSample(index);
        return sample.unpack();
    }

    function getTotalSamples() external pure override returns (uint256) {
        return Buffer.SIZE;
    }

    /**
     * @dev Processes new price and invariant data, updating the latest sample or creating a new one.
     *
     * Receives the new logarithms of values to store: `logPairPrice`, `logBptPrice` and `logInvariant`, as well the
     * index of the latest sample and the timestamp of its creation.
     *
     * Returns the index of the latest sample. If different from `latestIndex`, the caller should also store the
     * timestamp, and pass it on future calls to this function.
     */
    function _processPriceData(
        uint256 latestSampleCreationTimestamp,
        uint256 latestIndex,
        int256 logPairPrice,
        int256 logBptPrice,
        int256 logInvariant
    ) internal returns (uint256) {
        // Read latest sample, and compute the next one by updating it with the newly received data.
        bytes32 sample = _getSample(latestIndex).update(logPairPrice, logBptPrice, logInvariant, block.timestamp);

        // We create a new sample if more than _MAX_SAMPLE_DURATION seconds have elapsed since the creation of the
        // latest one. In other words, no sample accumulates data over a period larger than _MAX_SAMPLE_DURATION.
        bool newSample = block.timestamp - latestSampleCreationTimestamp >= _MAX_SAMPLE_DURATION;
        latestIndex = newSample ? latestIndex.next() : latestIndex;

        // Store the updated or new sample.
        _samples[latestIndex] = sample;

        return latestIndex;
    }

    /**
     * @dev Returns the instant value for `variable` in the sample pointed to by `index`.
     */
    function _getInstantValue(IPriceOracle.Variable variable, uint256 index) internal view returns (int256) {
        bytes32 sample = _getSample(index);
        _require(sample.timestamp() > 0, Errors.ORACLE_NOT_INITIALIZED);

        return sample.instant(variable);
    }

    /**
     * @dev Returns the value of the accumulator for `variable` `ago` seconds ago. `latestIndex` must be the index of
     * the latest sample in the buffer.
     *
     * Reverts under the following conditions:
     *  - if the buffer is empty.
     *  - if querying past information and the buffer has not been fully initialized.
     *  - if querying older information than available in the buffer. Note that a full buffer guarantees queries for the
     *    past 34 hours will not revert.
     *
     * If requesting information for a timestamp later than the latest one, it is extrapolated using the latest
     * available data.
     *
     * When no exact information is available for the requested past timestamp (as usually happens, since at most one
     * timestamp is stored every two minutes), it is estimated by performing linear interpolation using the closest
     * values. This process is guaranteed to complete performing at most 10 storage reads.
     */
    function _getPastAccumulator(
        IPriceOracle.Variable variable,
        uint256 latestIndex,
        uint256 ago
    ) internal view returns (int256) {
        // `ago` must not be before the epoch.
        _require(block.timestamp >= ago, Errors.ORACLE_INVALID_SECONDS_QUERY);
        uint256 lookUpTime = block.timestamp - ago;

        bytes32 latestSample = _getSample(latestIndex);
        uint256 latestTimestamp = latestSample.timestamp();

        // The latest sample only has a non-zero timestamp if no data was ever processed and stored in the buffer.
        _require(latestTimestamp > 0, Errors.ORACLE_NOT_INITIALIZED);

        if (latestTimestamp <= lookUpTime) {
            // The accumulator at times ahead the latest one are computed by extrapolating the latest data. This is
            // equivalent to the instant value not changing between the last timestamp and the look up time.

            // We can use unchecked arithmetic since the accumulator can be represented in 53 bits, timestamps in 31
            // bits, and the instant value in 22 bits.
            uint256 elapsed = lookUpTime - latestTimestamp;
            return latestSample.accumulator(variable) + (latestSample.instant(variable) * int256(elapsed));
        } else {
            // The look up time is before the latest sample, but we need to make sure that it is not before the oldest
            // sample as well.

            // Since we use a circular buffer, the oldest sample is simply the next one.
            uint256 oldestIndex = latestIndex.next();
            {
                // Local scope used to prevent stack-too-deep errors.
                bytes32 oldestSample = _getSample(oldestIndex);
                uint256 oldestTimestamp = oldestSample.timestamp();

                // For simplicity's sake, we only perform past queries if the buffer has been fully initialized. This
                // means the oldest sample must have a non-zero timestamp.
                _require(oldestTimestamp > 0, Errors.ORACLE_NOT_INITIALIZED);
                // The only remaining condition to check is for the look up time to be between the oldest and latest
                // timestamps.
                _require(oldestTimestamp <= lookUpTime, Errors.ORACLE_QUERY_TOO_OLD);
            }

            // Perform binary search to find nearest samples to the desired timestamp.
            (bytes32 prev, bytes32 next) = _findNearestSample(lookUpTime, oldestIndex);

            // `next`'s timestamp is guaranteed to be larger than `prev`'s, so we can skip checked arithmetic.
            uint256 samplesTimeDiff = next.timestamp() - prev.timestamp();

            if (samplesTimeDiff > 0) {
                // We estimate the accumulator at the requested look up time by interpolating linearly between the
                // previous and next accumulators.

                // We can use unchecked arithmetic since the accumulators can be represented in 53 bits, and timestamps
                // in 31 bits.
                int256 samplesAccDiff = next.accumulator(variable) - prev.accumulator(variable);
                uint256 elapsed = lookUpTime - prev.timestamp();
                return prev.accumulator(variable) + ((samplesAccDiff * int256(elapsed)) / int256(samplesTimeDiff));
            } else {
                // Rarely, one of the samples will the the exact requested look up time, which is indicated by `prev`
                // and `next` being the same. In this case, we simply return the accumulator at that point in time.
                return prev.accumulator(variable);
            }
        }
    }

    /**
     * @dev Finds the two samples with timestamps before and after `lookUpDate`. If one of the samples matches exactly,
     * both `prev` and `next` will be it. `offset` is the index of the oldest sample in the buffer.
     *
     * Assumes `lookUpDate` is greater or equal than the timestamp of the oldest sample, and less or equal than the
     * timestamp of the latest sample.
     */
    function _findNearestSample(uint256 lookUpDate, uint256 offset) internal view returns (bytes32 prev, bytes32 next) {
        // We're going to perform a binary seach in the circular buffer, which requires for it to be sorted. To achieve
        // this, we offset all buffer accesses by `offset`, making the first element the oldest one.

        // Auxiliary variables in a typical binary search: we will look at some value `mid` between `low` and `high`,
        // periodically increasing `low` or decreasing `high` until we either find a match or determine the element is
        // not in the array.
        uint256 low = 0;
        uint256 high = Buffer.SIZE - 1;
        uint256 mid;

        // If the search fails and no sample has a timestamp of `lookUpDate` (as is the most common scenario), `sample`
        // will be either the sample with the largest timestamp smaller than `lookUpDate`, or the one with the smallest
        // timestamp larger than `lookUpDate`.
        bytes32 sample;
        uint256 sampleTimestamp;

        while (low <= high) {
            // Mid is the floor of the average.
            uint256 midWithoutOffset = (high + low) / 2;

            // Recall that the buffer is not actually sorted: we need to apply the offset to access it in a sorted way.
            mid = midWithoutOffset.add(offset);
            sample = _getSample(mid);
            sampleTimestamp = sample.timestamp();

            if (sampleTimestamp < lookUpDate) {
                // If the mid sample is bellow the look up date, then increase the low index to start from there.
                low = midWithoutOffset + 1;
            } else if (sampleTimestamp > lookUpDate) {
                // If the mid sample is above the look up date, then decrease the high index to start from there.

                // We can skip checked arithmetic: it is imposible for `high` to ever be 0, as a scenario wher `low`
                // equals 0 and `high` equals 1 would result in `low` increasing to 1 if the previous `if` clause.
                high = midWithoutOffset - 1;
            } else {
                // sampleTimestamp == lookUpDate
                // If we have an exact match, return the sample as both `prev` and `next`.
                return (sample, sample);
            }
        }

        // In case we reach here, it means we didn't find exactly the sample we where looking for.
        return sampleTimestamp < lookUpDate ? (sample, _getSample(mid.next())) : (_getSample(mid.prev()), sample);
    }

    /**
     * @dev Returns the sample that corresponds to a given `index`.
     *
     * Using this function instead of accessing storage directly results in denser bytecode (since the storage slot is
     * only computed here).
     */
    function _getSample(uint256 index) internal view returns (bytes32) {
        return _samples[index];
    }
}
