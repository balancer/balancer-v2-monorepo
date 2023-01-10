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

import "./IGaugeAdder.sol";
import "./IStakelessGauge.sol";

/**
 * @title L2 Gauge Checkpointer interface
 * @notice Manages checkpoints for L2 gauges, allowing to perform mutiple checkpoints in a single call.
 * @dev Supports Polygon, Arbitrum, Optimism, Gnosis and ZKSync stakeless root gauges. Gauges to be checkpointed need
 * to be added to the controller beforehand.
 */
interface IL2GaugeCheckpointer {
    /**
     * @dev Emitted when a gauge is added to the checkpointer.
     */
    event GaugeAdded(IGaugeAdder.GaugeType indexed gaugeType, IStakelessGauge indexed gauge);

    /**
     * @dev Emitted when a gauge is removed from the checkpointer.
     */
    event GaugeRemoved(IGaugeAdder.GaugeType indexed gaugeType, IStakelessGauge indexed gauge);

    /**
     * @dev Adds an array of gauges from the given type.
     * Gauges added will be considered when performing checkpoints.
     * The gauges to add should meet the following preconditions:
     * - They must have been created in a valid GaugeFactory, according to GaugeAdder#isGaugeFromValidFactory.
     * - They must exist in the GaugeController, according to GaugeController#gauge_exists.
     * - They must not be killed.
     * - They must not have been previously added to the checkpointer.
     * @param gaugeType - Type of the gauge.
     * @param gauges - Gauges to add.
     */
    function addGauges(IGaugeAdder.GaugeType gaugeType, IStakelessGauge[] calldata gauges) external;

    /**
     * @dev Removes an array of gauges from the given type.
     * Removed gauges will not be considered when performing checkpoints. To remove gauges:
     * - They must be killed.
     * - They must have been previously added to the checkpointer.
     * @param gaugeType - Type of the gauge.
     * @param gauges - Gauges to remove.
     */
    function removeGauges(IGaugeAdder.GaugeType gaugeType, IStakelessGauge[] calldata gauges) external;

    /**
     * @dev Returns true if the given gauge was added for the given type; false otherwise.
     * @param gaugeType - Type of the gauge.
     * @param gauge - Gauge to check.
     */
    function hasGauge(IGaugeAdder.GaugeType gaugeType, IStakelessGauge gauge) external view returns (bool);

    /**
     * @dev Returns the amount of added gauges for a given type.
     * @param gaugeType - Type of the gauge.
     */
    function getTotalGauges(IGaugeAdder.GaugeType gaugeType) external view returns (uint256);

    /**
     * @dev Returns the gauge of a given type at the given index.
     * Reverts if the index is greater than or equal to the amount of added gauges for the given type.
     * @param gaugeType - Type of the gauge.
     * @param index - Index of the added gauge.
     */
    function getGaugeAtIndex(IGaugeAdder.GaugeType gaugeType, uint256 index) external view returns (IStakelessGauge);

    /**
     * @dev Performs a checkpoint for all added gauges above the given relative weight threshold.
     * Reverts if the ETH sent in the call is not enough to cover bridge costs.
     * @param minRelativeWeight - Threshold to filter out gauges below it.
     */
    function checkpointGaugesAboveRelativeWeight(uint256 minRelativeWeight) external payable;

    /**
     * @dev Performs a checkpoint for all added gauges of a given type above the given relative weight threshold.
     * Reverts if the ETH sent in the call is not enough to cover bridge costs.
     * @param gaugeType - Type of the gauge.
     * @param minRelativeWeight - Threshold to filter out gauges below it.
     */
    function checkpointGaugesOfTypeAboveRelativeWeight(IGaugeAdder.GaugeType gaugeType, uint256 minRelativeWeight)
        external
        payable;

    /**
     * @dev Returns the ETH cost to checkpoint all gauges for a given minimum relative weight.
     * A lower minimum relative weight might return higher costs, since more gauges could potentially be included
     * in the checkpoint.
     */
    function getTotalBridgeCost(uint256 minRelativeWeight) external view returns (uint256);

    /**
     * @dev Returns true if gauge type is Polygon, Arbitrum, Optimism, Gnosis or ZKSync; false otherwise.
     */
    function isSupportedGaugeType(IGaugeAdder.GaugeType gaugeType) external pure returns (bool);
}
