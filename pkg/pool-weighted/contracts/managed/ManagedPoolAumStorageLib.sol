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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

/**
 * @title Managed Pool AUM Storage Library
 * @notice Library for manipulating a bitmap used for Pool state used for charging AUM fees in ManagedPool.
 */
library ManagedPoolAumStorageLib {
    using WordCodec for bytes32;

    // Store AUM fee values:
    // Percentage of AUM to be paid as fees yearly.
    // Timestamp of the most recent collection of AUM fees.
    //
    // [  164 bit |        32 bits       |    60 bits   ]
    // [  unused  | last collection time | aum fee pct. ]
    // |MSB                                          LSB|
    uint256 private constant _AUM_FEE_PERCENTAGE_OFFSET = 0;
    uint256 private constant _LAST_COLLECTION_TIMESTAMP_OFFSET = _AUM_FEE_PERCENTAGE_OFFSET + _AUM_FEE_PCT_WIDTH;

    uint256 private constant _TIMESTAMP_WIDTH = 32;
    // 2**60 ~= 1.1e18 so this is sufficient to store the full range of potential AUM fees.
    uint256 private constant _AUM_FEE_PCT_WIDTH = 60;

    // Getters

    /**
     * @notice Returns the current AUM fee percentage and the timestamp of the last fee collection.
     * @param aumState - The byte32 state of the Pool's AUM fees.
     * @return aumFeePercentage - The percentage of the AUM of the Pool to be charged as fees yearly.
     * @return lastCollectionTimestamp - The timestamp of the last collection of AUM fees.
     */
    function getAumFeeFields(bytes32 aumState)
        internal
        pure
        returns (uint256 aumFeePercentage, uint256 lastCollectionTimestamp)
    {
        aumFeePercentage = aumState.decodeUint(_AUM_FEE_PERCENTAGE_OFFSET, _AUM_FEE_PCT_WIDTH);
        lastCollectionTimestamp = aumState.decodeUint(_LAST_COLLECTION_TIMESTAMP_OFFSET, _TIMESTAMP_WIDTH);
    }

    // Setters

    /**
     * @notice Sets the AUM fee percentage describing what fraction of the Pool should be charged as fees yearly.
     * @param aumState - The byte32 state of the Pool's AUM fees.
     * @param aumFeePercentage - The new percentage of the AUM of the Pool to be charged as fees yearly.
     */
    function setAumFeePercentage(bytes32 aumState, uint256 aumFeePercentage) internal pure returns (bytes32) {
        return aumState.insertUint(aumFeePercentage, _AUM_FEE_PERCENTAGE_OFFSET, _AUM_FEE_PCT_WIDTH);
    }

    /**
     * @notice Sets the timestamp of the last collection of AUM fees
     * @param aumState - The byte32 state of the Pool's AUM fees.
     * @param timestamp - The timestamp of the last collection of AUM fees. `block.timestamp` should usually be passed.
     */
    function setLastCollectionTimestamp(bytes32 aumState, uint256 timestamp) internal pure returns (bytes32) {
        return aumState.insertUint(timestamp, _LAST_COLLECTION_TIMESTAMP_OFFSET, _TIMESTAMP_WIDTH);
    }
}
