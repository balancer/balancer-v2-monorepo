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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "../interfaces/IVotingEscrow.sol";

contract FeeDistributor is ReentrancyGuard {
    IVotingEscrow private immutable _votingEscrow;

    // Global State
    uint256 private immutable _startTime;
    uint256 private _timeCursor;
    mapping(uint256 => uint256) private _veSupplyCache;
    uint256 private _lastTokenTime;


    constructor(IVotingEscrow votingEscrow, uint256 startTime) {
        _votingEscrow = votingEscrow;

        startTime = _roundDownTimestamp(startTime);
        _startTime = startTime;
        _timeCursor = startTime;
    }

    /**
     * @dev Return the epoch number corresponding to the provided timestamp
     */
    function _findTimestampEpoch(uint256 timestamp) internal view returns (uint256) {
        uint256 min = 0;
        uint256 max = _votingEscrow.epoch();
        
        // Perform binary search through epochs to find epoch containing `timestamp`
        for(uint256 i = 0; i < 128; ++i){
            if (min >= max) break;
            
            uint256 mid = (min + max + 2) / 2;
            IVotingEscrow.Point memory pt = _votingEscrow.point_history(mid);
            if (pt.ts <= timestamp) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
    }

    /**
     * @dev Cache the totalSupply of VotingEscrow token at the beginning of each new week
     */
    function _checkpointTotalSupply() internal {
        uint256 timeCursor = _timeCursor;
        uint256 weekStart = _roundDownTimestamp(block.timestamp);
        _votingEscrow.checkpoint();

        // Step through the each week and cache the total supply at beginning of week on this contract
        for (uint256 i = 0; i < 20; ++i){
            if (timeCursor > weekStart) break;

            uint256 epoch = _findTimestampEpoch(timeCursor);
            IVotingEscrow.Point memory pt = _votingEscrow.point_history(epoch);
            
            int128 dt = 0;
            if (timeCursor > pt.ts) {
                // If the point is at 0 epoch, it can actually be earlier than the first deposit
                // Then make dt 0
                dt = int128(timeCursor - pt.ts);
            }
            
            // Set supply as max(pt.bias - pt.slope * dt, 0)
            if (pt.bias > pt.slope * dt) {
                _veSupplyCache[timeCursor] = uint256(pt.bias - pt.slope * dt);
            }

            timeCursor += 1 weeks;
        }
        _timeCursor = timeCursor;
    }

    /**
     * @dev Rounds the provided timestamp down to the beginning of the previous week (Thurs 00:00 UTC)
     */
    function _roundDownTimestamp(uint256 timestamp) pure private returns (uint256) {
        return (timestamp / 1 weeks) * 1 weeks;
    }
}
