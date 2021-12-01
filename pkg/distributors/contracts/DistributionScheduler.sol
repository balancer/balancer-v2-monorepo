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

    enum DistributionStatus { UNINITIALIZED, PENDING, STARTED }

    struct ScheduledDistribution {
        bytes32 distributionId;
        IERC20 stakingToken;
        IERC20 distributionToken;
        uint256 startTime;
        address owner;
        uint256 amount;
        DistributionStatus status;
    }

    event DistributionScheduled(
        bytes32 scheduleId,
        address indexed owner,
        IERC20 indexed stakingToken,
        IERC20 indexed distributionToken,
        uint256 startTime,
        uint256 amount
    );
    event DistributionStarted(
        bytes32 scheduleId,
        address indexed owner,
        IERC20 indexed stakingToken,
        IERC20 indexed distributionToken,
        uint256 startTime,
        uint256 amount
    );

    mapping(bytes32 => ScheduledDistribution) private _scheduledDistributions;

    function getScheduledDistributionInfo(bytes32 scheduleId)
        external
        view
        returns (ScheduledDistribution memory)
    {
        return _scheduledDistributions[scheduleId];
    }

    function getScheduleId(
        IERC20 stakingToken,
        IERC20 distributionToken,
        address owner,
        uint256 startTime
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(stakingToken, distributionToken, owner, startTime));
    }

    function scheduleDistribution(
        bytes32 distributionId,
        IERC20 stakingToken,
        IERC20 distributionToken,
        uint256 amount,
        uint256 startTime
    ) public returns (bytes32 scheduleId) {
        scheduleId = getScheduleId(stakingToken, distributionToken, msg.sender, startTime);
        require(startTime > block.timestamp, "Distribution can only be scheduled for the future");

        require(
            _scheduledDistributions[scheduleId].status == DistributionStatus.UNINITIALIZED,
            "Distribution has already been scheduled"
        );

        _scheduledDistributions[scheduleId] = ScheduledDistribution({
            distributionId: distributionId,
            stakingToken: stakingToken,
            distributionToken: distributionToken,
            owner: msg.sender,
            amount: amount,
            startTime: startTime,
            status: DistributionStatus.PENDING
        });

        distributionToken.safeTransferFrom(msg.sender, address(this), amount);

        emit DistributionScheduled(scheduleId, msg.sender, stakingToken, distributionToken, startTime, amount);
    }

    function startDistributions(bytes32[] calldata scheduleIds) external {
        for (uint256 i; i < scheduleIds.length; i++) {
            bytes32 scheduleId = scheduleIds[i];
            ScheduledDistribution memory scheduledDistribution = _scheduledDistributions[scheduleId];

            if (scheduledDistribution.status != DistributionStatus.PENDING) {
                continue;
            }

            require(block.timestamp >= scheduledDistribution.startTime, "Distribution start time is in the future");

            _scheduledDistributions[scheduleId].status = DistributionStatus.STARTED;

            scheduledDistribution.distributionToken.approve(address(_multiDistributor), scheduledDistribution.amount);
            _multiDistributor.fundDistribution(scheduledDistribution.distributionId, scheduledDistribution.amount);

            emit DistributionStarted(
                scheduleId,
                scheduledDistribution.owner,
                scheduledDistribution.stakingToken,
                scheduledDistribution.distributionToken,
                scheduledDistribution.startTime,
                scheduledDistribution.amount
            );
        }
    }
}
