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
        bytes32 sample = _samples[currentIndex].update(logPairPrice, logBptPrice, logInvariant, block.timestamp);

        // We create a new sample if more than _MAX_SAMPLE_DURATION seconds have elapsed since the creation of the
        // current one. In other words, no sample accumulates data over a period larger than _MAX_SAMPLE_DURATION.
        bool newSample = block.timestamp - currentSampleInitialTimestamp >= _MAX_SAMPLE_DURATION;
        sampleIndex = newSample ? ((currentIndex + 1) % _BUFFER_SIZE) : currentIndex;

        // Store the updated or new sample.
        _samples[sampleIndex] = sample;
    }
}
