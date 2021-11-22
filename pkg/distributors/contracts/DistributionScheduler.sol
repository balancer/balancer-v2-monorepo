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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "./interfaces/IMultiDistributor.sol";

// solhint-disable not-rely-on-time

/**
 * Scheduler for MultiDistributor contract
 */
contract DistributionScheduler {
    using SafeERC20 for IERC20;

    IMultiDistributor private immutable _multiDistributor;

    constructor(IMultiDistributor multiDistributor) {
        _multiDistributor = multiDistributor;
    }

    enum RewardStatus { UNINITIALIZED, PENDING, STARTED }

    struct ScheduledReward {
        bytes32 distributionId;
        IERC20 stakingToken;
        IERC20 distributionToken;
        uint256 startTime;
        address owner;
        uint256 amount;
        RewardStatus status;
    }

    event DistributionScheduled(
        bytes32 rewardId,
        address indexed owner,
        IERC20 indexed stakingToken,
        IERC20 indexed distributionToken,
        uint256 startTime,
        uint256 amount
    );
    event DistributionStarted(
        bytes32 rewardId,
        address indexed owner,
        IERC20 indexed stakingToken,
        IERC20 indexed distributionToken,
        uint256 startTime,
        uint256 amount
    );

    mapping(bytes32 => ScheduledReward) private _rewards;

    function getScheduledDistributionInfo(bytes32 rewardId) external view returns (ScheduledReward memory reward) {
        return _rewards[rewardId];
    }

    function startRewards(bytes32[] calldata rewardIds) external {
        for (uint256 r; r < rewardIds.length; r++) {
            bytes32 rewardId = rewardIds[r];
            ScheduledReward memory scheduledReward = _rewards[rewardId];

            require(scheduledReward.status == RewardStatus.PENDING, "Reward cannot be started");
            require(scheduledReward.startTime <= block.timestamp, "Reward start time is in the future");

            _rewards[rewardId].status = RewardStatus.STARTED;

            uint256 allowance = scheduledReward.distributionToken.allowance(address(this), address(_multiDistributor));
            if (allowance < scheduledReward.amount) {
                scheduledReward.distributionToken.approve(address(_multiDistributor), type(uint256).max);
            }
            _multiDistributor.fundDistribution(scheduledReward.distributionId, scheduledReward.amount);
            emit DistributionStarted(
                rewardId,
                scheduledReward.owner,
                scheduledReward.stakingToken,
                scheduledReward.distributionToken,
                scheduledReward.startTime,
                scheduledReward.amount
            );
        }
    }

    function claimId(
        IERC20 stakingToken,
        IERC20 distributionToken,
        address rewarder,
        uint256 startTime
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(stakingToken, distributionToken, rewarder, startTime));
    }

    function scheduleDistribution(
        bytes32 distributionId,
        IERC20 stakingToken,
        IERC20 distributionToken,
        uint256 amount,
        uint256 startTime
    ) public returns (bytes32 rewardId) {
        rewardId = claimId(stakingToken, distributionToken, msg.sender, startTime);
        require(startTime > block.timestamp, "Reward can only be scheduled for the future");

        require(_rewards[rewardId].status == RewardStatus.UNINITIALIZED, "Reward has already been scheduled");

        _rewards[rewardId] = ScheduledReward({
            distributionId: distributionId,
            stakingToken: stakingToken,
            distributionToken: distributionToken,
            owner: msg.sender,
            amount: amount,
            startTime: startTime,
            status: RewardStatus.PENDING
        });

        distributionToken.safeTransferFrom(msg.sender, address(this), amount);

        emit DistributionScheduled(rewardId, msg.sender, stakingToken, distributionToken, startTime, amount);
    }
}
