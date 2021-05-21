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

import "../oracle/Samples.sol";
import "../oracle/PoolPriceOracle.sol";
import "../IPriceOracle.sol";

contract PoolPriceOracleMock is PoolPriceOracle {
    using Samples for bytes32;

    struct Sample {
        int256 logPairPrice;
        int256 accLogPairPrice;
        int256 logBptPrice;
        int256 accLogBptPrice;
        int256 logInvariant;
        int256 accLogInvariant;
        uint256 timestamp;
    }

    event PriceDataProcessed(bool newSample, uint256 sampleIndex);

    function encode(Sample memory sample) public pure returns (bytes32) {
        return
            Samples.pack(
                sample.logPairPrice,
                sample.accLogPairPrice,
                sample.logBptPrice,
                sample.accLogBptPrice,
                sample.logInvariant,
                sample.accLogInvariant,
                sample.timestamp
            );
    }

    function decode(bytes32 sample) public pure returns (Sample memory) {
        return
            Sample({
                logPairPrice: sample.instant(IPriceOracle.Variable.PAIR_PRICE),
                accLogPairPrice: sample.accumulator(IPriceOracle.Variable.PAIR_PRICE),
                logBptPrice: sample.instant(IPriceOracle.Variable.BPT_PRICE),
                accLogBptPrice: sample.accumulator(IPriceOracle.Variable.BPT_PRICE),
                logInvariant: sample.instant(IPriceOracle.Variable.INVARIANT),
                accLogInvariant: sample.accumulator(IPriceOracle.Variable.INVARIANT),
                timestamp: sample.timestamp()
            });
    }

    function mockSample(uint256 index, Sample memory sample) public {
        _samples[index] = encode(sample);
    }

    function mockSamples(uint256[] memory indexes, Sample[] memory samples) public {
        for (uint256 i = 0; i < indexes.length; i++) {
            mockSample(indexes[i], samples[i]);
        }
    }

    function update(
        bytes32 sample,
        int256 logPairPrice,
        int256 logBptPrice,
        int256 logInvariant,
        uint256 timestamp
    ) public pure returns (Sample memory) {
        return decode(sample.update(logPairPrice, logBptPrice, logInvariant, timestamp));
    }

    function processPriceData(
        uint256 elapsed,
        uint256 currentIndex,
        int256 logPairPrice,
        int256 logBptPrice,
        int256 logInvariant
    ) public {
        uint256 currentSampleInitialTimestamp = block.timestamp - elapsed;
        uint256 sampleIndex = _processPriceData(
            currentSampleInitialTimestamp,
            currentIndex,
            logPairPrice,
            logBptPrice,
            logInvariant
        );
        emit PriceDataProcessed(sampleIndex != currentIndex, sampleIndex);
    }

    struct BinarySearchResult {
        uint256 prev;
        uint256 next;
    }

    function findNearestSamplesTimestamp(uint256[] memory dates, uint256 offset)
        external
        view
        returns (BinarySearchResult[] memory results)
    {
        results = new BinarySearchResult[](dates.length);
        for (uint256 i = 0; i < dates.length; i++) {
            (bytes32 prev, bytes32 next) = _findNearestSample(dates[i], offset);
            results[i] = BinarySearchResult({ prev: prev.timestamp(), next: next.timestamp() });
        }
    }

    function getPastAccumulator(
        IPriceOracle.Variable variable,
        uint256 currentIndex,
        uint256 timestamp
    ) external view returns (int256) {
        return _getPastAccumulator(variable, currentIndex, block.timestamp - timestamp);
    }
}
