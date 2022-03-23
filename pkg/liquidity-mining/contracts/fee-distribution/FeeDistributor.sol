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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/IAuthentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "../interfaces/IVotingEscrow.sol";

contract FeeDistributor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant _TOKEN_CHECKPOINT_DEADLINE = 1 days;

    IVotingEscrow private immutable _votingEscrow;

    uint256 private immutable _startTime;

    // Global State
    uint256 private _timeCursor;
    mapping(uint256 => uint256) private _veSupplyCache;

    // Token State
    mapping(IERC20 => uint256) private _tokenStartTime;
    mapping(IERC20 => uint256) private _tokenTimeCursor;
    mapping(IERC20 => uint256) private _tokenLastBalance;
    mapping(IERC20 => mapping(uint256 => uint256)) private _tokensPerWeek;

    // User State
    mapping(address => uint256) private _userTimeCursor;
    mapping(address => uint256) private _userLastEpochCheckpointed;
    mapping(address => mapping(uint256 => uint256)) private _userBalanceAtTimestamp;
    mapping(address => mapping(IERC20 => uint256)) private _userTokenTimeCursor;

    constructor(IVotingEscrow votingEscrow, uint256 startTime) {
        _votingEscrow = votingEscrow;

        require(startTime >= _roundUpTimestamp(block.timestamp), "Must start after current week");
        startTime = _roundDownTimestamp(startTime);
        _startTime = startTime;
        _timeCursor = startTime;
    }

    function checkpointToken(IERC20 token) external {
        // Prevent someone from assigning tokens to an inaccessible week.
        require(block.timestamp > _startTime, "Fee distribution has not started yet");
        _checkpointToken(token, true);
    }

    function claimToken(address user, IERC20 token) external returns (uint256) {
        // Prevent someone from assigning tokens to an inaccessible week.
        require(block.timestamp > _startTime, "Fee distribution has not started yet");
        _checkpointTotalSupply();
        _checkpointToken(token, false);
        _checkpointUserBalance(user);

        uint256 amount = _claimToken(user, token);
        return amount;
    }

    // Internal functions

    /**
     * @dev It is required that both the global, token and user state have been properly checkpointed
     * before calling this function.
     */
    function _claimToken(address user, IERC20 token) internal returns (uint256) {
        uint256 userTimeCursor = _getUserTokenTimeCursor(user, token);
        // We round `_tokenTimeCursor` down so it represents the beginning of the first incomplete week.
        uint256 currentActiveWeek = _roundDownTimestamp(_tokenTimeCursor[token]);
        mapping(uint256 => uint256) storage tokensPerWeek = _tokensPerWeek[token];
        mapping(uint256 => uint256) storage userBalanceAtTimestamp = _userBalanceAtTimestamp[user];

        uint256 amount;
        for (uint256 i = 0; i < 20; ++i) {
            // We only want to claim for complete weeks so break once we reach `currentActiveWeek`.
            // This is as `tokensPerWeek[currentActiveWeek]` will continue to grow over the week.
            if (userTimeCursor >= currentActiveWeek) break;

            amount +=
                (tokensPerWeek[userTimeCursor] * userBalanceAtTimestamp[userTimeCursor]) /
                _veSupplyCache[userTimeCursor];
            userTimeCursor += 1 weeks;
        }
        _userTokenTimeCursor[user][token] = userTimeCursor;

        if (amount > 0) {
            _tokenLastBalance[token] -= amount;
            token.safeTransfer(user, amount);
        }

        return amount;
    }

    /**
     * @dev Calculate the amount of `token` to be distributed to `_votingEscrow` holders since the last checkpoint.
     */
    function _checkpointToken(IERC20 token, bool force) internal {
        uint256 lastTokenTime = _tokenTimeCursor[token];
        uint256 timeSinceLastCheckpoint;
        if (lastTokenTime == 0) {
            // If it's the first time we're checkpointing this token then start distributing from now.
            // Also mark at which timestamp users should start attempt to claim this token from.
            lastTokenTime = block.timestamp;
            _tokenStartTime[token] = _roundDownTimestamp(block.timestamp);
        } else {
            timeSinceLastCheckpoint = block.timestamp - lastTokenTime;
            if (!force && timeSinceLastCheckpoint < _TOKEN_CHECKPOINT_DEADLINE) {
                // We can prevent a lot of SSTORES by only checkpointing tokens at a minimum interval
                return;
            }
        }

        _tokenTimeCursor[token] = block.timestamp;

        uint256 tokenBalance = token.balanceOf(address(this));
        uint256 tokensToDistribute = tokenBalance - _tokenLastBalance[token];
        _tokenLastBalance[token] = tokenBalance;

        if (tokensToDistribute == 0) return;

        uint256 thisWeek = _roundDownTimestamp(lastTokenTime);
        uint256 nextWeek = 0;

        // Distribute `tokensToDistribute` evenly across the time period from `lastTokenTime` to now.
        // These tokens are assigned to weeks proportionally to how much of this period falls into each week.
        mapping(uint256 => uint256) storage tokensPerWeek = _tokensPerWeek[token];
        for (uint256 i = 0; i < 20; ++i) {
            nextWeek = thisWeek + 1 weeks;
            if (block.timestamp < nextWeek) {
                // `thisWeek` is now the beginning of the current week, i.e. this is the final iteration.
                if (timeSinceLastCheckpoint == 0 && block.timestamp == lastTokenTime) {
                    tokensPerWeek[thisWeek] += tokensToDistribute;
                } else {
                    tokensPerWeek[thisWeek] +=
                        (tokensToDistribute * (block.timestamp - lastTokenTime)) /
                        timeSinceLastCheckpoint;
                }
                // As we've caught up to the present then we should now break
                break;
            } else {
                // We've gone a full week or more without checkpointing so need to distribute tokens to previous weeks
                if (timeSinceLastCheckpoint == 0 && nextWeek == lastTokenTime) {
                    // It shouldn't be possible to enter this block
                    tokensPerWeek[thisWeek] += tokensToDistribute;
                } else {
                    tokensPerWeek[thisWeek] +=
                        (tokensToDistribute * (nextWeek - lastTokenTime)) /
                        timeSinceLastCheckpoint;
                }
            }

            // We've now "checkpointed" up to the beginning of next week so must update timestamps appropriately.
            lastTokenTime = nextWeek;
            thisWeek = nextWeek;
        }
    }

    /**
     * @dev Cache the `user`'s balance of `_votingEscrow` at the beginning of each new week
     */
    function _checkpointUserBalance(address user) internal {
        // Minimal user_epoch is 0 (if user had no point)
        uint256 userEpoch = 0;
        uint256 maxUserEpoch = _votingEscrow.user_point_epoch(user);

        // If user has never locked then they won't receive fees
        if (maxUserEpoch == 0) return;

        // weekCursor represents the timestamp of the beginning of the week from which we
        // start checkpointing the user's VotingEscrow balance.
        uint256 weekCursor = _userTimeCursor[user];
        if (weekCursor == 0) {
            // First checkpoint for user so need to do the initial binary search
            userEpoch = _findTimestampUserEpoch(user, _startTime, maxUserEpoch);
        } else {
            if (weekCursor == _roundDownTimestamp(block.timestamp)) {
                // User has checkpointed this week already so perform early return
                return;
            }
            // Otherwise use the value saved from last time
            userEpoch = _userLastEpochCheckpointed[user];
        }

        // Epoch 0 is always empty so bump onto the next one so that we start on a valid epoch.
        if (userEpoch == 0) {
            userEpoch = 1;
        }

        IVotingEscrow.Point memory userPoint = _votingEscrow.user_point_history(user, userEpoch);

        // If this is the first checkpoint for the user, calculate the first week they're eligible for.
        // i.e. the timestamp of the first Thursday after they locked.
        if (weekCursor == 0) {
            weekCursor = _roundUpTimestamp(userPoint.ts);
        }

        // Sanity check - can't claim fees from before fee distribution started.
        if (weekCursor < _startTime) {
            weekCursor = _startTime;
        }

        IVotingEscrow.Point memory oldUserPoint;
        for (uint256 i = 0; i < 50; ++i) {
            if (weekCursor >= userPoint.ts && userEpoch <= maxUserEpoch) {
                // The week being considered lies inside the user epoch described by `userPoint`.
                // We then shift it into `oldUserPoint` and query the Point for the next user epoch.
                // We do this because we need to know the end timestamp for the epoch.
                userEpoch += 1;
                oldUserPoint = userPoint;
                if (userEpoch > maxUserEpoch) {
                    userPoint = IVotingEscrow.Point(0, 0, 0, 0);
                } else {
                    userPoint = _votingEscrow.user_point_history(user, userEpoch);
                }
            } else {
                // The week being considered lies inside the user epoch described by `oldUserPoint`
                // we can then use it to calculate the user's balance at the beginning of the week.

                int128 dt = int128(weekCursor - oldUserPoint.ts);
                uint256 userBalance = oldUserPoint.bias > oldUserPoint.slope * dt
                    ? uint256(oldUserPoint.bias - oldUserPoint.slope * dt)
                    : 0;

                // User's lock has expired and they haven't relocked yet.
                if (userBalance == 0 && userEpoch > maxUserEpoch) break;

                // User had a nonzero lock and so is eligible to collect fees.
                if (userBalance > 0) {
                    _userBalanceAtTimestamp[user][weekCursor] = userBalance;
                }
            }

            weekCursor += 1 weeks;
        }

        _userLastEpochCheckpointed[user] = userEpoch - 1;
        _userTimeCursor[user] = weekCursor;
    }

    /**
     * @dev Cache the totalSupply of VotingEscrow token at the beginning of each new week
     */
    function _checkpointTotalSupply() internal {
        uint256 timeCursor = _timeCursor;
        uint256 weekStart = _roundDownTimestamp(block.timestamp);

        // We expect `timeCursor == weekStart + 1 weeks` when fully up to date.
        if (timeCursor >= weekStart) {
            // We've already checkpointed up to this week so perform early return
            return;
        }

        _votingEscrow.checkpoint();

        // Step through the each week and cache the total supply at beginning of week on this contract
        for (uint256 i = 0; i < 20; ++i) {
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
        // Update state to the end of the current week (`weekStart` + 1 weeks)
        _timeCursor = timeCursor;
    }

    // Helper functions

    /**
     * @dev Wrapper around `_userTokenTimeCursor` which returns the start timestamp for `token`
     * if `user` has not attempted to interact with it previously.
     */
    function _getUserTokenTimeCursor(address user, IERC20 token) internal view returns (uint256) {
        uint256 userTimeCursor = _userTokenTimeCursor[user][token];
        return userTimeCursor > 0 ? userTimeCursor : _tokenStartTime[token];
    }

    /**
     * @dev Return the epoch number corresponding to the provided timestamp
     */
    function _findTimestampEpoch(uint256 timestamp) internal view returns (uint256) {
        uint256 min = 0;
        uint256 max = _votingEscrow.epoch();

        // Perform binary search through epochs to find epoch containing `timestamp`
        for (uint256 i = 0; i < 128; ++i) {
            if (min >= max) break;

            // +2 avoids getting stuck in min == mid < max
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
     * @dev Return the user epoch number for `user` corresponding to the provided `timestamp`
     */
    function _findTimestampUserEpoch(
        address user,
        uint256 timestamp,
        uint256 maxUserEpoch
    ) internal view returns (uint256) {
        uint256 min = 0;
        uint256 max = maxUserEpoch;

        // Perform binary search through epochs to find epoch containing `timestamp`
        for (uint256 i = 0; i < 128; ++i) {
            if (min >= max) break;

            // +2 avoids getting stuck in min == mid < max
            uint256 mid = (min + max + 2) / 2;
            IVotingEscrow.Point memory pt = _votingEscrow.user_point_history(user, mid);
            if (pt.ts <= timestamp) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
    }

    /**
     * @dev Rounds the provided timestamp down to the beginning of the previous week (Thurs 00:00 UTC)
     */
    function _roundDownTimestamp(uint256 timestamp) private pure returns (uint256) {
        return (timestamp / 1 weeks) * 1 weeks;
    }

    /**
     * @dev Rounds the provided timestamp up to the beginning of the next week (Thurs 00:00 UTC)
     */
    function _roundUpTimestamp(uint256 timestamp) private pure returns (uint256) {
        return _roundDownTimestamp(timestamp + 1 weeks - 1);
    }
}
