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

import "./IGaugeAdder.sol";
import "./IStakelessGauge.sol";

/**
 * @title Stakeless Gauge Checkpointer interface
 * @notice Manages checkpoints for L2 and mainnet stakeless root gauges, allowing to perform mutiple checkpoints in a
 * single call.
 * @dev Supports gauge types registered in `GaugeAdder`.
 * Gauges to be checkpointed need to be added to the controller beforehand.
 */
interface IStakelessGaugeCheckpointer {
    // String values are hashed when indexed, so we also emit the raw string as a data field for ease of use.
    /**
     * @notice Emitted when a gauge is added to the checkpointer.
     */
    event GaugeAdded(IStakelessGauge indexed gauge, string indexed indexedGaugeType, string gaugeType);

    /**
     * @notice Emitted when a gauge is removed from the checkpointer.
     */
    event GaugeRemoved(IStakelessGauge indexed gauge, string indexed indexedGaugeType, string gaugeType);

    /**
     * @notice Returns `GaugeAdder` contract.
     */
    function getGaugeAdder() external view returns (IGaugeAdder);

    /**
     * @notice Returns gauge types available in the checkpointer.
     */
    function getGaugeTypes() external view returns (string[] memory);

    /**
     * @notice Adds an array of gauges from the given type. This is a permissioned function.
     * @dev Gauges added will be considered when performing checkpoints.
     * The gauges to add should meet the following preconditions:
     * - They must exist in the GaugeController, according to GaugeController#gauge_exists.
     * - They must not be killed.
     * - They must not have been previously added to the checkpointer.
     * Unlike `addGauges`, this function can add gauges that were created by factories registered in a deprecated
     * `GaugeAdder`, and therefore cannot be validated by the current `GaugeAdder`.
     * @param gaugeType Type of the gauge.
     * @param gauges Gauges to add.
     */
    function addGaugesWithVerifiedType(string memory gaugeType, IStakelessGauge[] calldata gauges) external;

    /**
     * @notice Adds an array of gauges from the given type.
     * @dev Gauges added will be considered when performing checkpoints.
     * The gauges to add should meet the following preconditions:
     * - They must have been created in a valid `GaugeFactory`, according to `GaugeAdder#isGaugeFromValidFactory`.
     * - They must exist in the `GaugeController`, according to `GaugeController#gauge_exists`.
     * - They must not be killed.
     * - They must not have been previously added to the checkpointer.
     * @param gaugeType Type of the gauge.
     * @param gauges Gauges to add.
     */
    function addGauges(string memory gaugeType, IStakelessGauge[] calldata gauges) external;

    /**
     * @notice Removes an array of gauges from the given type.
     * @dev Removed gauges will not be considered when performing checkpoints. To remove gauges:
     * - They must be killed.
     * - They must have been previously added to the checkpointer.
     * @param gaugeType Type of the gauge.
     * @param gauges Gauges to remove.
     */
    function removeGauges(string memory gaugeType, IStakelessGauge[] calldata gauges) external;

    /**
     * @notice Returns true if the given gauge was added for the given type; false otherwise.
     * @param gaugeType Type of the gauge.
     * @param gauge Gauge to check.
     */
    function hasGauge(string memory gaugeType, IStakelessGauge gauge) external view returns (bool);

    /**
     * @notice Returns the amount of added gauges for a given type.
     * @param gaugeType Type of the gauge.
     */
    function getTotalGauges(string memory gaugeType) external view returns (uint256);

    /**
     * @notice Returns the gauge of a given type at the given index.
     * @dev Reverts if the index is greater than or equal to the amount of added gauges for the given type.
     * @param gaugeType Type of the gauge.
     * @param index - Index of the added gauge.
     */
    function getGaugeAtIndex(string memory gaugeType, uint256 index) external view returns (IStakelessGauge);

    /**
     * @notice Returns the timestamp corresponding to the start of the previous week of the current block.
     */
    function getRoundedDownBlockTimestamp() external view returns (uint256);

    /**
     * @notice Performs a checkpoint for all added gauges above the given relative weight threshold.
     * @dev Reverts if the ETH sent in the call is not enough to cover bridge costs.
     * @param minRelativeWeight Threshold to filter out gauges below it.
     */
    function checkpointGaugesAboveRelativeWeight(uint256 minRelativeWeight) external payable;

    /**
     * @notice Performs a checkpoint for all added gauges of a given type above the given relative weight threshold.
     * @dev Reverts if the ETH sent in the call is not enough to cover bridge costs.
     * @param gaugeType Type of the gauge.
     * @param minRelativeWeight Threshold to filter out gauges below it.
     */
    function checkpointGaugesOfTypeAboveRelativeWeight(string memory gaugeType, uint256 minRelativeWeight)
        external
        payable;

    /**
     * @notice Performs a checkpoint for a single added gauge of a given type.
     * Reverts if the ETH sent in the call is not enough to cover bridge costs.
     * Reverts if the gauge was not added to the checkpointer beforehand.
     * @param gaugeType Type of the gauge.
     * @param gauge Address of the gauge to checkpoint.
     */
    function checkpointSingleGauge(string memory gaugeType, address gauge) external payable;

    /**
     * @notice Performs a checkpoint for a multiple added gauges of the given types.
     * Reverts if the ETH sent in the call is not enough to cover bridge costs.
     * Reverts if the gauges were not added to the checkpointer beforehand.
     * @param gaugeTypes Types of the gauges to be checkpointed. If a single type is provided, it is applied to all of
     * the gauges, otherwise the gauge types array should be equal in length to the gauges.
     * @param gauges Addresses of the gauges to checkpoint.
     */
    function checkpointMultipleGauges(string[] memory gaugeTypes, address[] memory gauges) external payable;

    /**
     * @notice Returns the ETH cost to checkpoint a single given gauge.
     * @dev Reverts if the gauge was not added to the checkpointer beforehand.
     * @param gaugeType Type of the gauge.
     * @param gauge Address of the gauge to check the bridge costs.
     */
    function getSingleBridgeCost(string memory gaugeType, address gauge) external view returns (uint256);

    /**
     * @notice Returns the ETH cost to checkpoint all gauges for a given minimum relative weight.
     * @dev A lower minimum relative weight might return higher costs, since more gauges could potentially be included
     * in the checkpoint.
     */
    function getTotalBridgeCost(uint256 minRelativeWeight) external view returns (uint256);

    /**
     * @notice Returns true if gauge type is valid; false otherwise.
     */
    function isValidGaugeType(string memory gaugeType) external view returns (bool);
}
