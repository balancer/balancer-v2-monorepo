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
 * It uses a circular buffer to store past data, where the data within each sample is the result of
 * accumulating live data for no more than two minutes. Therefore, assuming the worst case scenario where new data is
 * updated in every single block, the oldest samples in the buffer (and therefore largest queryable period) will
 * be 2 minutes * the buffer size: 34 hours for the default size of 1024.
 *
 * Usage of this module requires the caller to keep track of two variables: the latest circular buffer index, and the
 * timestamp when the index last changed. Additionally, access to the latest circular buffer index must be exposed by
 * implementing `_getOracleIndex`.
 *
 * This contract relies on the `QueryProcessor` linked library to reduce bytecode size.
 */
abstract contract PoolPriceOracle is IPoolPriceOracle, IPriceOracle {
    using Buffer for uint256;
    using Samples for bytes32;
    using WordCodec for bytes32;

    // Each sample in the buffer accumulates information for up to 2 minutes. This is simply to reduce the size of the
    // buffer: small time deviations will not have any significant effect.
    // solhint-disable not-rely-on-time
    uint256 private constant _MAX_SAMPLE_DURATION = 2 minutes;
    uint256 private constant _DEFAULT_BUFFER_SIZE = 1024;

    // We use a mapping to simulate an array: since we will always use valid indexes using a mapping saves gas
    // by skipping the bounds checks.
    mapping(uint256 => bytes32) internal _samples;

    // [ 208 bits |   32 bits   |     16 bits     |
    // [ unused   | buffer size | sample duration |
    // |MSB                                    LSB|
    bytes32 private _oracleState;

    uint256 private constant _SAMPLE_DURATION_OFFSET = 0;
    uint256 private constant _BUFFER_SIZE_OFFSET = 16;

    // Event declarations

    event OracleSampleDurationChanged(uint256 sampleDuration);
    event OracleBufferSizeChanged(uint256 bufferSize);

    constructor() {
        _setOracleSampleDuration(_MAX_SAMPLE_DURATION);
        _setOracleBufferSize(_DEFAULT_BUFFER_SIZE);
    }

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
        _require(index < getTotalSamples(), Errors.ORACLE_INVALID_INDEX);

        bytes32 sample = _getSample(index);
        return sample.unpack();
    }

    function getTotalSamples() public view override returns (uint256) {
        return _oracleState.decodeUint32(_BUFFER_SIZE_OFFSET);
    }

    function getSampleDuration() public view override returns (uint256) {
        return _oracleState.decodeUint16(_SAMPLE_DURATION_OFFSET);
    }

    // Create mapping entries for all slots from the current one up to the buffer size
    // Timestamp will be 0, so these entries will not be used until overwritten with real data
    function initializeOracle() public {       
        uint256 bufferSize =  getTotalSamples();
        bytes32 lastSample = _getSample(bufferSize - 1);
 
        // NOOP if already initialized - don't overwrite valid data
        // If the oracle is fully initialized, _samples[bufferSize - 1] will have a timestamp,
        // and therefore a non-zero value
        if (lastSample == 0) {
            bytes32 nullSample;

            for (uint256 i = _getOracleIndex() + 1; i < bufferSize; i++) {
                _samples[i] = nullSample;
            }
        }
    }

    // Set a new buffer size - can only be bigger - and initialize it
    // Gas cost should discourage extremely large buffer sizes
    function _extendOracleBuffer(uint256 newBufferSize) internal {        
        _setOracleBufferSize(newBufferSize);

        initializeOracle();
    }

    function _setOracleBufferSize(uint256 newBufferSize) private {
        _require(newBufferSize > getTotalSamples(), Errors.ORACLE_BUFFER_SIZE_TOO_SMALL);

        _oracleState = _oracleState.insertUint32(newBufferSize, _BUFFER_SIZE_OFFSET);

        emit OracleBufferSizeChanged(newBufferSize);
    }

    function _setOracleSampleDuration(uint256 newDuration) internal {
        _require(newDuration <= _MAX_SAMPLE_DURATION, Errors.ORACLE_SAMPLE_DURATION_TOO_LONG);

        _oracleState = _oracleState.insertUint16(newDuration, _SAMPLE_DURATION_OFFSET);

        emit OracleSampleDurationChanged(newDuration);
    }

    // IPriceOracle

    function getLargestSafeQueryWindow() external view override returns (uint256) {
        bytes32 oracleState = _oracleState;

        return oracleState.decodeUint16(_SAMPLE_DURATION_OFFSET) * oracleState.decodeUint32(_BUFFER_SIZE_OFFSET);
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
            results[i] = QueryProcessor.getTimeWeightedAverage(_samples, getTotalSamples(), queries[i], latestIndex);
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

        // We create a new sample if more than _sampleDuration seconds have elapsed since the creation of the
        // latest one. In other words, no sample accumulates data over a period larger than _sampleDuration.
        bool newSample = block.timestamp - latestSampleCreationTimestamp >= getSampleDuration();
        latestIndex = newSample ? latestIndex.next(getTotalSamples()) : latestIndex;

        // Store the updated or new sample.
        _samples[latestIndex] = sample;

        return latestIndex;
    }

    function _getPastAccumulator(
        IPriceOracle.Variable variable,
        uint256 latestIndex,
        uint256 ago
    ) internal view returns (int256) {
        return QueryProcessor.getPastAccumulator(_samples, getTotalSamples(), variable, latestIndex, ago);
    }

    function _findNearestSample(uint256 lookUpDate, uint256 offset) internal view returns (bytes32 prev, bytes32 next) {
        return QueryProcessor.findNearestSample(_samples, getTotalSamples(), lookUpDate, offset);
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
