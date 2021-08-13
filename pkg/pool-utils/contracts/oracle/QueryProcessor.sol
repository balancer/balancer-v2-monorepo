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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/LogCompression.sol";

import "../interfaces/IPriceOracle.sol";

import "./Buffer.sol";
import "./Samples.sol";

/**
 * @dev Auxiliary library for PoolPriceOracle, offloading most of the query code to reduce bytecode size by using this
 * as a linked library. The downside is an extra DELEGATECALL is added (2600 gas as of the Berlin hardfork), but the
 * bytecode size gains are so big (specially of the oracle contract does not use `LogCompression.fromLowResLog`) that
 * it is worth it.
 */
library QueryProcessor {
    using Buffer for uint256;
    using Samples for bytes32;
    using LogCompression for int256;

    /**
     * @dev Returns the value for `variable` at the indexed sample.
     */
    function getInstantValue(
        mapping(uint256 => bytes32) storage samples,
        IPriceOracle.Variable variable,
        uint256 index
    ) external view returns (uint256) {
        bytes32 sample = samples[index];
        _require(sample.timestamp() > 0, Errors.ORACLE_NOT_INITIALIZED);

        int256 rawInstantValue = sample.instant(variable);
        return LogCompression.fromLowResLog(rawInstantValue);
    }

    /**
     * @dev Returns the time average weighted price corresponding to `query`.
     */
    function getTimeWeightedAverage(
        mapping(uint256 => bytes32) storage samples,
        IPriceOracle.OracleAverageQuery memory query,
        uint256 latestIndex
    ) external view returns (uint256) {
        _require(query.secs != 0, Errors.ORACLE_BAD_SECS);

        int256 beginAccumulator = getPastAccumulator(samples, query.variable, latestIndex, query.ago + query.secs);
        int256 endAccumulator = getPastAccumulator(samples, query.variable, latestIndex, query.ago);
        return LogCompression.fromLowResLog((endAccumulator - beginAccumulator) / int256(query.secs));
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
    function getPastAccumulator(
        mapping(uint256 => bytes32) storage samples,
        IPriceOracle.Variable variable,
        uint256 latestIndex,
        uint256 ago
    ) public view returns (int256) {
        // solhint-disable not-rely-on-time
        // `ago` must not be before the epoch.
        _require(block.timestamp >= ago, Errors.ORACLE_INVALID_SECONDS_QUERY);
        uint256 lookUpTime = block.timestamp - ago;

        bytes32 latestSample = samples[latestIndex];
        uint256 latestTimestamp = latestSample.timestamp();

        // The latest sample only has a non-zero timestamp if no data was ever processed and stored in the buffer.
        _require(latestTimestamp > 0, Errors.ORACLE_NOT_INITIALIZED);

        if (latestTimestamp <= lookUpTime) {
            // The accumulator at times ahead of the latest one are computed by extrapolating the latest data. This is
            // equivalent to the instant value not changing between the last timestamp and the look up time.

            // We can use unchecked arithmetic since the accumulator can be represented in 53 bits, timestamps in 31
            // bits, and the instant value in 22 bits.
            uint256 elapsed = lookUpTime - latestTimestamp;
            return latestSample.accumulator(variable) + (latestSample.instant(variable) * int256(elapsed));
        } else {
            // The look up time is before the latest sample, but we need to make sure that it is not before the oldest
            // sample as well.

            // Since we use a circular buffer, the oldest sample is simply the next one.
            uint256 bufferLength;
            uint256 oldestIndex = latestIndex.next();
            {
                // Local scope used to prevent stack-too-deep errors.
                bytes32 oldestSample = samples[oldestIndex];
                uint256 oldestTimestamp = oldestSample.timestamp();

                if (oldestTimestamp > 0) {
                    // If the oldest timestamp is not zero, it means the buffer was fully initialized.
                    bufferLength = Buffer.SIZE;
                } else {
                    // If the buffer was not fully initialized, we haven't wrapped around it yet,
                    // and can treat it as a regular array where the oldest index is the first one,
                    // and the length the number of samples.
                    bufferLength = oldestIndex; // Equal to latestIndex.next()
                    oldestIndex = 0;
                    oldestTimestamp = samples[0].timestamp();
                }

                // Finally check that the look up time is not previous to the oldest timestamp.
                _require(oldestTimestamp <= lookUpTime, Errors.ORACLE_QUERY_TOO_OLD);
            }

            // Perform binary search to find nearest samples to the desired timestamp.
            (bytes32 prev, bytes32 next) = findNearestSample(samples, lookUpTime, oldestIndex, bufferLength);

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
                // Rarely, one of the samples will have the exact requested look up time, which is indicated by `prev`
                // and `next` being the same. In this case, we simply return the accumulator at that point in time.
                return prev.accumulator(variable);
            }
        }
    }

    /**
     * @dev Finds the two samples with timestamps before and after `lookUpDate`. If one of the samples matches exactly,
     * both `prev` and `next` will be it. `offset` is the index of the oldest sample in the buffer. `length` is the size
     * of the samples list.
     *
     * Assumes `lookUpDate` is greater or equal than the timestamp of the oldest sample, and less or equal than the
     * timestamp of the latest sample.
     */
    function findNearestSample(
        mapping(uint256 => bytes32) storage samples,
        uint256 lookUpDate,
        uint256 offset,
        uint256 length
    ) public view returns (bytes32 prev, bytes32 next) {
        // We're going to perform a binary search in the circular buffer, which requires it to be sorted. To achieve
        // this, we offset all buffer accesses by `offset`, making the first element the oldest one.

        // Auxiliary variables in a typical binary search: we will look at some value `mid` between `low` and `high`,
        // periodically increasing `low` or decreasing `high` until we either find a match or determine the element is
        // not in the array.
        uint256 low = 0;
        uint256 high = length - 1;
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
            sample = samples[mid];
            sampleTimestamp = sample.timestamp();

            if (sampleTimestamp < lookUpDate) {
                // If the mid sample is bellow the look up date, then increase the low index to start from there.
                low = midWithoutOffset + 1;
            } else if (sampleTimestamp > lookUpDate) {
                // If the mid sample is above the look up date, then decrease the high index to start from there.

                // We can skip checked arithmetic: it is impossible for `high` to ever be 0, as a scenario where `low`
                // equals 0 and `high` equals 1 would result in `low` increasing to 1 in the previous `if` clause.
                high = midWithoutOffset - 1;
            } else {
                // sampleTimestamp == lookUpDate
                // If we have an exact match, return the sample as both `prev` and `next`.
                return (sample, sample);
            }
        }

        // In case we reach here, it means we didn't find exactly the sample we where looking for.
        return sampleTimestamp < lookUpDate ? (sample, samples[mid.next()]) : (samples[mid.prev()], sample);
    }
}
