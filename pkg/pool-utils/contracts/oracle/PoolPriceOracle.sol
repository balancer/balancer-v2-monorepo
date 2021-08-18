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

import "../interfaces/IPriceOracle.sol";
import "../interfaces/IPoolPriceOracle.sol";

import "./Buffer.sol";
import "./Samples.sol";
import "./QueryProcessor.sol";

/**
 * @dev This module allows Pools to access historical pricing information.
 *
 * It uses a 1024 long circular buffer to store past data, where the data within each sample is the result of
 * accumulating live data for no more than two minutes. Therefore, assuming the worst case scenario where new data is
 * updated in every single block, the oldest samples in the buffer (and therefore largest queryable period) will
 * be slightly over 34 hours old.
 *
 * Usage of this module requires the caller to keep track of two variables: the latest circular buffer index, and the
 * timestamp when the index last changed. Aditionally, access to the latest circular buffer index must be exposed by
 * implementing `_getOracleIndex`.
 *
 * This contract relies on the `QueryProcessor` linked library to reduce bytecode size.
 */
abstract contract PoolPriceOracle is IPoolPriceOracle, IPriceOracle {
    using Buffer for uint256;
    using Samples for bytes32;

    // Each sample in the buffer accumulates information for up to 2 minutes. This is simply to reduce the size of the
    // buffer: small time deviations will not have any significant effect.
    // solhint-disable not-rely-on-time
    uint256 private constant _MAX_SAMPLE_DURATION = 2 minutes;

    // We use a mapping to simulate an array: the buffer won't grow or shrink, and since we will always use valid
    // indexes using a mapping saves gas by skipping the bounds checks.
    mapping(uint256 => bytes32) internal _samples;

    // IPoolPriceOracle

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
     * @dev Manually dirty oracle sample storage slots with dummy data, to reduce the gas cost of the future swaps
     * that will initialize them. This function is only useful before the oracle has been fully initialized.
     *
     * `endIndex` is non-inclusive.
     */
    function dirtyUninitializedOracleSamples(uint256 startIndex, uint256 endIndex) external {
        _require(startIndex < endIndex && endIndex <= Buffer.SIZE, Errors.OUT_OF_BOUNDS);

        // Uninitialized samples are identified by a zero timestamp -- all other fields are ignored,
        // so any non-zero value with a zero timestamp suffices.
        bytes32 initSample = Samples.pack(1, 0, 0, 0, 0, 0, 0);
        for (uint256 i = startIndex; i < endIndex; i++) {
            if (_samples[i].timestamp() == 0) {
                _samples[i] = initSample;
            }
        }
    }

    // IPriceOracle

    function getLargestSafeQueryWindow() external pure override returns (uint256) {
        return 34 hours;
    }

    function getLatest(Variable variable) external view override returns (uint256) {
        return QueryProcessor.getInstantValue(_samples, variable, _getOracleIndex());
    }

    function getTimeWeightedAverage(OracleAverageQuery[] memory queries)
        external
        view
        override
        returns (uint256[] memory results)
    {
        results = new uint256[](queries.length);
        uint256 latestIndex = _getOracleIndex();

        for (uint256 i = 0; i < queries.length; ++i) {
            results[i] = QueryProcessor.getTimeWeightedAverage(_samples, queries[i], latestIndex);
        }
    }

    function getPastAccumulators(OracleAccumulatorQuery[] memory queries)
        external
        view
        override
        returns (int256[] memory results)
    {
        results = new int256[](queries.length);
        uint256 latestIndex = _getOracleIndex();

        OracleAccumulatorQuery memory query;
        for (uint256 i = 0; i < queries.length; ++i) {
            query = queries[i];
            results[i] = _getPastAccumulator(query.variable, latestIndex, query.ago);
        }
    }

    // Internal functions

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

    function _getPastAccumulator(
        IPriceOracle.Variable variable,
        uint256 latestIndex,
        uint256 ago
    ) internal view returns (int256) {
        return QueryProcessor.getPastAccumulator(_samples, variable, latestIndex, ago);
    }

    function _findNearestSample(
        uint256 lookUpDate,
        uint256 offset,
        uint256 length
    ) internal view returns (bytes32 prev, bytes32 next) {
        return QueryProcessor.findNearestSample(_samples, lookUpDate, offset, length);
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

    /**
     * @dev Virtual function to be implemented by derived contracts. Must return the current index of the oracle
     * circular buffer.
     */
    function _getOracleIndex() internal view virtual returns (uint256);
}
