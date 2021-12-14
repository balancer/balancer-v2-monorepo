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

import "./IMultiDistributor.sol";

interface IDistributionScheduler {
    enum DistributionStatus { UNINITIALIZED, PENDING, STARTED, CANCELLED }

    struct ScheduledDistribution {
        bytes32 distributionId;
        uint256 startTime;
        uint256 amount;
        DistributionStatus status;
    }

    event DistributionScheduled(
        bytes32 indexed distributionId,
        bytes32 indexed scheduleId,
        uint256 startTime,
        uint256 amount
    );
    event DistributionStarted(bytes32 indexed distributionId, bytes32 indexed scheduleId);
    event DistributionCancelled(bytes32 indexed distributionId, bytes32 indexed scheduleId);

    function getScheduledDistributionInfo(bytes32 scheduleId) external view returns (ScheduledDistribution memory);

    function getScheduleId(bytes32 distributionId, uint256 startTime) external pure returns (bytes32);

    function scheduleDistribution(
        bytes32 distributionId,
        uint256 amount,
        uint256 startTime
    ) external returns (bytes32 scheduleId);

    function startDistributions(bytes32[] calldata scheduleIds) external;

    function cancelDistribution(bytes32 scheduleId) external;
}
