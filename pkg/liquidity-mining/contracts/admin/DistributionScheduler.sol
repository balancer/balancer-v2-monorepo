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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IRewardTokenDistributor.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

// solhint-disable not-rely-on-time

/**
 * @title DistributionScheduler
 * @notice Scheduler for setting up permissionless distributions of liquidity gauge reward tokens.
 * @dev Any address may send tokens to the DistributionSchedule to be distributed among gauge depositors.
 */
contract DistributionScheduler {
    using SafeERC20 for IERC20;

    uint256 private constant _MAX_REWARDS = 8;

    // The node at _HEAD contains no value, and simply points to the actual first node. The last node points to _NULL.
    uint32 private constant _HEAD = 0;
    uint32 private constant _NULL = 0;

    // gauge-token pair -> timestamp -> (amount, nextTimestamp)
    mapping(bytes32 => mapping(uint32 => RewardNode)) private _rewardsLists;

    struct RewardNode {
        uint224 amount;
        uint32 nextTimestamp;
    }

    /**
     * @notice Returns information on the reward paid out to `gauge` in `token` over the week starting at `timestamp`
     * @param gauge - The gauge which is to distribute the reward token.
     * @param token - The token which is to be distributed among gauge depositors.
     * @param timestamp - The timestamp corresponding to the beginning of the week being queried.
     * @return - the amount of `token` which is to be distributed over the week starting at `timestamp`.
     *         - the timestamp of the next scheduled distribution of `token` to `gauge`. Zero if no distribution exists.
     */
    function getRewardNode(
        IRewardTokenDistributor gauge,
        IERC20 token,
        uint256 timestamp
    ) external view returns (RewardNode memory) {
        return _rewardsLists[_getRewardsListId(gauge, token)][uint32(timestamp)];
    }

    /**
     * @notice Returns the amount of `token` which is ready to be distributed by `gauge` as of the current timestamp.
     * @param gauge - The gauge which is to distribute the reward token.
     * @param token - The token which is to be distributed among gauge depositors.
     */
    function getPendingRewards(IRewardTokenDistributor gauge, IERC20 token) public view returns (uint256) {
        return getPendingRewardsAt(gauge, token, block.timestamp);
    }

    /**
     * @notice Returns the amount of `token` which is ready to be distributed by `gauge` as of a specified timestamp.
     * @param gauge - The gauge which is to distribute the reward token.
     * @param token - The token which is to be distributed among gauge depositors.
     * @param timestamp - The future timestamp in which to query.
     */
    function getPendingRewardsAt(
        IRewardTokenDistributor gauge,
        IERC20 token,
        uint256 timestamp
    ) public view returns (uint256) {
        mapping(uint32 => RewardNode) storage rewardsList = _rewardsLists[_getRewardsListId(gauge, token)];

        (, uint256 amount) = _getPendingRewards(rewardsList, timestamp);
        return amount;
    }

    /**
     * @notice Schedule a distribution of tokens to gauge depositors over the span of 1 week.
     * @dev All distributions must start at the beginning of a week in UNIX time, i.e. Thurs 00:00 UTC.
     * This is to prevent griefing from many low value distributions having to be processed before a meaningful
     * distribution can be processed.
     * @param gauge - The gauge which is to distribute the reward token.
     * @param token - The token which is to be distributed among gauge depositors.
     * @param amount - The amount of tokens which to distribute.
     * @param startTime - The timestamp at the beginning of the week over which to distribute tokens.
     */
    function scheduleDistribution(
        IRewardTokenDistributor gauge,
        IERC20 token,
        uint256 amount,
        uint256 startTime
    ) external {
        require(amount > 0, "Must provide non-zero number of tokens");

        // Ensure that values won't overflow when put into storage.
        require(amount <= type(uint224).max, "Reward amount overflow");
        require(startTime <= type(uint32).max, "Reward timestamp overflow");

        // Ensure that a user doesn't add a reward token which becomes locked on scheduler
        address rewardDistributor = gauge.reward_data(token).distributor;
        require(rewardDistributor != address(0), "Reward token does not exist on gauge");
        require(rewardDistributor == address(this), "DistributionScheduler is not reward token's distributor");

        // Prevent griefing by creating many small distributions which must be processed.
        require(startTime >= block.timestamp, "Distribution can only be scheduled for the future");
        require(startTime == _roundDownTimestamp(startTime), "Distribution must start at the beginning of the week");

        // Avoid mistakes causing rewards being locked far into the future.
        require(startTime - block.timestamp <= 365 days, "Distribution too far into the future");

        token.safeTransferFrom(msg.sender, address(this), amount);

        _insertReward(_rewardsLists[_getRewardsListId(gauge, token)], uint32(startTime), uint224(amount));
    }

    /**
     * @notice Process all pending distributions for a gauge to start distributing the tokens.
     * @param gauge - The gauge which is to distribute the reward token.
     */
    function startDistributions(IRewardTokenDistributor gauge) external {
        for (uint256 i = 0; i < _MAX_REWARDS; ++i) {
            IERC20 token = gauge.reward_tokens(i);
            if (token == IERC20(0)) break;

            // Only attempt to start distributions for tokens which we are the distributor for
            address rewardDistributor = gauge.reward_data(token).distributor;
            if (rewardDistributor == address(this)) {
                startDistributionForToken(gauge, token);
            }
        }
    }

    /**
     * @notice Process all pending distributions for a given token for a gauge to start distributing tokens.
     * @param gauge - The gauge which is to distribute the reward token.
     * @param token - The token which is to be distributed among gauge depositors.
     */
    function startDistributionForToken(IRewardTokenDistributor gauge, IERC20 token) public {
        mapping(uint32 => RewardNode) storage rewardsList = _rewardsLists[_getRewardsListId(gauge, token)];

        (uint32 firstUnprocessedNodeKey, uint256 rewardAmount) = _getPendingRewards(rewardsList, block.timestamp);

        // These calls are reentrancy-safe as we've already performed our only state transition (updating the head of
        // the list)
        rewardsList[_HEAD].nextTimestamp = firstUnprocessedNodeKey;

        token.approve(address(gauge), rewardAmount);
        gauge.deposit_reward_token(token, rewardAmount);
    }

    // Internal functions

    function _getRewardsListId(IRewardTokenDistributor gauge, IERC20 rewardToken) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(gauge, rewardToken));
    }

    /**
     * @dev Sums the rewards held on all pending reward nodes with a key lesser than `targetKey`.
     * @return - the key corresponding to the first node with a key greater than `targetKey`.
     *         - the cumulative rewards held on all pending nodes before `targetKey`
     */
    function _getPendingRewards(mapping(uint32 => RewardNode) storage rewardsList, uint256 targetKey)
        internal
        view
        returns (uint32, uint256)
    {
        uint32 currentNodeKey = rewardsList[_HEAD].nextTimestamp;

        // Iterate through all nodes which are ready to be started, summing the values of each.
        uint256 amount;
        while (targetKey >= currentNodeKey && currentNodeKey != _NULL) {
            amount += rewardsList[currentNodeKey].amount;

            currentNodeKey = rewardsList[currentNodeKey].nextTimestamp;
        }

        return (currentNodeKey, amount);
    }

    /**
     * @dev Find the position of the new node in the list of pending nodes and insert it.
     */
    function _insertReward(
        mapping(uint32 => RewardNode) storage rewardsList,
        uint32 insertedNodeKey,
        uint224 amount
    ) private {
        // We want to find two nodes which sit either side of the new node to be created so we can insert between them.

        uint32 currentNodeKey = _HEAD;
        uint32 nextNodeKey = rewardsList[currentNodeKey].nextTimestamp;

        // Search through nodes until the new node sits somewhere between `currentNodeKey` and `nextNodeKey`, or
        // we process all nodes.
        while (insertedNodeKey > nextNodeKey && nextNodeKey != _NULL) {
            currentNodeKey = nextNodeKey;
            nextNodeKey = rewardsList[currentNodeKey].nextTimestamp;
        }

        if (nextNodeKey == _NULL) {
            // We reached the end of the list and so can just append the new node.
            rewardsList[currentNodeKey].nextTimestamp = insertedNodeKey;
            rewardsList[insertedNodeKey] = RewardNode(amount, _NULL);
        } else if (nextNodeKey == insertedNodeKey) {
            // There already exists a node at the time we want to insert one.
            // We then just increase the value of this node.

            uint256 rewardAmount = uint256(rewardsList[nextNodeKey].amount) + amount;
            require(rewardAmount <= type(uint224).max, "Reward amount overflow");
            rewardsList[nextNodeKey].amount = uint224(rewardAmount);
        } else {
            // We're inserting a node in between `currentNodeKey` and `nextNodeKey` so then update
            // `currentNodeKey` to point to the newly inserted node and the new node to point to `nextNodeKey`.
            rewardsList[insertedNodeKey] = RewardNode(amount, nextNodeKey);
            rewardsList[currentNodeKey].nextTimestamp = insertedNodeKey;
        }
    }

    /**
     * @dev Rounds the provided timestamp down to the beginning of the previous week (Thurs 00:00 UTC)
     */
    function _roundDownTimestamp(uint256 timestamp) private pure returns (uint256) {
        return (timestamp / 1 weeks) * 1 weeks;
    }
}
