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

import "./Samples.sol";

/**
 * @dev This module provides a simple interface to allow pools to give access to historic pricing information.
 * In particular it works with a circular buffer of 1024 slots (samples) guaranteeing that each of these samples
 * will not accumulate information for more than 2 consecutive minutes. Therefore, assuming the worst case where a
 * sample is updated on each block, the largest period that will be covered by the buffer is ≈ 34 hours.
 */
contract PoolPriceOracle {
    using Samples for bytes32;

    // The buffer is a circular storage structure with 1024 slots
    uint256 private constant _BUFFER_SIZE = 1024;

    // Each sample in the buffer will accumulate information for up-to 2 minutes
    uint256 private constant _MAX_SAMPLE_DURATION = 2 minutes;

    mapping(uint256 => bytes32) internal _samples;

    /**
     * @dev Process a price information based on the current index and the initial timestamp of the current sample.
     * Every time this function is call a sample in the buffer will be updated. The sample to update will be determined
     * based on the elapsed time from the initial timestamp of the current sample that was given. In case this diff is
     * larger than a constant duration, in this case 2 minutes, the updated price information will be written to next
     * sample in the buffer.
     *
     * @param logPairPrice The logarithmic value of the new reported pair price
     * @param logBptPrice The logarithmic value of the new reported BPT price
     * @param logInvariant The logarithmic value of the new reported invariant
     *
     * @return newSample Tells whether a new sample was created
     * @return sampleIndex The index of the sample where the updated information was written
     */
    function _processPriceData(
        uint256 currentSampleInitialTimestamp,
        uint256 currentIndex,
        int256 logPairPrice,
        int256 logBptPrice,
        int256 logInvariant
    ) internal returns (bool newSample, uint256 sampleIndex) {
        bytes32 currentSample = _samples[currentIndex];
        return
            _processPriceData(
                currentSample,
                currentSampleInitialTimestamp,
                currentIndex,
                logPairPrice,
                logBptPrice,
                logInvariant
            );
    }

    /**
     * @dev Same as `_processPriceData` but re-using the last log invariant stored in the current sample.
     */
    function _processPriceData(
        uint256 currentSampleInitialTimestamp,
        uint256 currentIndex,
        int256 logPairPrice,
        int256 logBptPrice
    ) internal returns (bool newSample, uint256 sampleIndex) {
        bytes32 currentSample = _samples[currentIndex];
        return
            _processPriceData(
                currentSample,
                currentSampleInitialTimestamp,
                currentIndex,
                logPairPrice,
                logBptPrice,
                currentSample.lastLogInvariant()
            );
    }

    /**
     * @dev Private function that actually process a price information for a sample.
     */
    function _processPriceData(
        bytes32 currentSample,
        uint256 currentSampleInitialTimestamp,
        uint256 currentIndex,
        int256 logPairPrice,
        int256 logBptPrice,
        int256 logInvariant
    ) private returns (bool newSample, uint256 sampleIndex) {
        // solhint-disable not-rely-on-time
        bytes32 sample = currentSample.update(logPairPrice, logBptPrice, logInvariant, block.timestamp);
        newSample = block.timestamp - currentSampleInitialTimestamp >= _MAX_SAMPLE_DURATION;
        sampleIndex = newSample ? ((currentIndex + 1) % _BUFFER_SIZE) : currentIndex;
        _samples[sampleIndex] = sample;
    }
}
