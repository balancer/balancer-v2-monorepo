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

import "../pools/oracle/Samples.sol";
import "../pools/oracle/PoolPriceOracle.sol";

contract PoolPriceOracleMock is PoolPriceOracle {
    using Samples for bytes32;

    struct Sample {
        int256 lastLogPairPrice;
        int256 accLogPairPrice;
        int256 lastLogBptPrice;
        int256 accLogBptPrice;
        int256 lastLogInvariant;
        int256 accLogInvariant;
        uint256 timestamp;
    }

    event PriceDataProcessed(bool newSample, uint256 sampleIndex);

    function mockSample(uint256 index, Sample memory sample) public {
        _samples[index] = pack(sample);
    }

    function getSample(uint256 index) public view returns (Sample memory) {
        return unpack(_samples[index]);
    }

    function update(
        bytes32 sample,
        int256 logPairPrice,
        int256 logBptPrice,
        int256 logInvariant,
        uint256 timestamp
    ) public pure returns (Sample memory) {
        return unpack(sample.update(logPairPrice, logBptPrice, logInvariant, timestamp));
    }

    function pack(Sample memory sample) public pure returns (bytes32) {
        return Samples.pack(
            sample.lastLogPairPrice,
            sample.accLogPairPrice,
            sample.lastLogBptPrice,
            sample.accLogBptPrice,
            sample.lastLogInvariant,
            sample.accLogInvariant,
            sample.timestamp
        );
    }

    function unpack(bytes32 sample) public pure returns (Sample memory) {
        return Sample({
            lastLogPairPrice: sample.lastLogPairPrice(),
            accLogPairPrice: sample.accLogPairPrice(),
            lastLogBptPrice: sample.lastLogBptPrice(),
            accLogBptPrice: sample.accLogBptPrice(),
            lastLogInvariant: sample.lastLogInvariant(),
            accLogInvariant: sample.accLogInvariant(),
            timestamp: sample.timestamp()
        });
    }

    function processPriceData(
        uint256 elapsed,
        uint256 currentIndex,
        int256 logPairPrice,
        int256 logBptPrice,
        int256 logInvariant
    )
        public returns (bool newSample, uint256 sampleIndex)
    {
        uint256 currentSampleInitialTimestamp = block.timestamp - elapsed;
        (newSample, sampleIndex) = _processPriceData(currentSampleInitialTimestamp, currentIndex, logPairPrice, logBptPrice, logInvariant);
        emit PriceDataProcessed(newSample, sampleIndex);
    }

    function processPriceDataWithLastInvariant(
        uint256 elapsed,
        uint256 currentIndex,
        int256 logPairPrice,
        int256 logBptPrice
    )
        public returns (bool newSample, uint256 sampleIndex)
    {
        uint256 currentSampleInitialTimestamp = block.timestamp - elapsed;
        (newSample, sampleIndex) = _processPriceData(currentSampleInitialTimestamp, currentIndex, logPairPrice, logBptPrice);
        emit PriceDataProcessed(newSample, sampleIndex);
    }
}
