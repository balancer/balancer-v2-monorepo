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

import "./interfaces/IDistributionScheduler.sol";

// solhint-disable not-rely-on-time

/**
 * Scheduler for MultiDistributor contract
 */
contract DistributionScheduler is IDistributionScheduler {
    using SafeERC20 for IERC20;

    IMultiDistributor private immutable _multiDistributor;
    mapping(bytes32 => ScheduledDistribution) private _scheduledDistributions;

    constructor(IMultiDistributor multiDistributor) {
        _multiDistributor = multiDistributor;
    }

    function getScheduledDistributionInfo(bytes32 scheduleId)
        external
        view
        override
        returns (ScheduledDistribution memory)
    {
        return _scheduledDistributions[scheduleId];
    }

    function getScheduleId(bytes32 distributionId, uint256 startTime) public pure override returns (bytes32) {
        return keccak256(abi.encodePacked(distributionId, startTime));
    }

    function scheduleDistribution(
        bytes32 distributionId,
        uint256 amount,
        uint256 startTime
    ) external override returns (bytes32 scheduleId) {
        scheduleId = getScheduleId(distributionId, startTime);
        require(
            _scheduledDistributions[scheduleId].status == DistributionStatus.UNINITIALIZED,
            "Distribution has already been scheduled"
        );

        require(startTime > block.timestamp, "Distribution can only be scheduled for the future");

        // As funding pushes out the end timestamp of the distribution channel
        // we only allow the distribution owner to schedule distributions
        IMultiDistributor.Distribution memory distributionChannel = _multiDistributor.getDistribution(distributionId);
        require(distributionChannel.owner == msg.sender, "Only distribution owner can schedule");

        distributionChannel.distributionToken.safeTransferFrom(msg.sender, address(this), amount);

        _scheduledDistributions[scheduleId] = ScheduledDistribution({
            distributionId: distributionId,
            amount: amount,
            startTime: startTime,
            status: DistributionStatus.PENDING
        });

        emit DistributionScheduled(distributionId, scheduleId, startTime, amount);
    }

    function startDistributions(bytes32[] calldata scheduleIds) external override {
        for (uint256 i; i < scheduleIds.length; i++) {
            bytes32 scheduleId = scheduleIds[i];
            ScheduledDistribution memory scheduledDistribution = _scheduledDistributions[scheduleId];

            // Silently skip any non-pending distributions as two users may be triggering two sets of
            // scheduleIds with some overlap. This ensures that all distributions are started properly.
            if (scheduledDistribution.status != DistributionStatus.PENDING) {
                continue;
            }

            // Check that scheduled distribution is ready to be started.

            require(block.timestamp >= scheduledDistribution.startTime, "Distribution start time is in the future");
            _scheduledDistributions[scheduleId].status = DistributionStatus.STARTED;

            // Send tokens to MultiDistributor and start distribution.

            IERC20 distributionToken = _multiDistributor
                .getDistribution(scheduledDistribution.distributionId)
                .distributionToken;

            distributionToken.approve(address(_multiDistributor), scheduledDistribution.amount);
            _multiDistributor.fundDistribution(scheduledDistribution.distributionId, scheduledDistribution.amount);

            emit DistributionStarted(scheduledDistribution.distributionId, scheduleId);
        }
    }

    function cancelDistribution(bytes32 scheduleId) external override {
        ScheduledDistribution memory scheduledDistribution = _scheduledDistributions[scheduleId];

        // Check that scheduled distribution is eligible for cancellation.

        require(scheduledDistribution.status != DistributionStatus.UNINITIALIZED, "Distribution does not exist");
        require(scheduledDistribution.status != DistributionStatus.STARTED, "Distribution has already started");
        require(
            scheduledDistribution.status != DistributionStatus.CANCELLED,
            "Distribution has already been cancelled"
        );

        _scheduledDistributions[scheduleId].status = DistributionStatus.CANCELLED;

        // Check that caller is distribution owner.

        IMultiDistributor.Distribution memory distributionChannel = _multiDistributor.getDistribution(
            scheduledDistribution.distributionId
        );

        require(distributionChannel.owner == msg.sender, "Only distribution owner can cancel");

        // Refund tokens to distribution owner.

        distributionChannel.distributionToken.safeTransfer(msg.sender, scheduledDistribution.amount);

        emit DistributionCancelled(scheduledDistribution.distributionId, scheduleId);
    }
}
