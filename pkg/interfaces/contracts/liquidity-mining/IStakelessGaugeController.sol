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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IStakelessGauge.sol";

/**
 * @title Stakeless Gauge Controller interface
 * @notice Manages checkpoints for registered stakeless gauges, allowing to perform mutiple checkpoints in a
 * single call.
 * @dev Supports Polygon, Arbitrum and Optimism stakeless root gauges. Gauges to be checkpointed need to be
 * registered (added) to the controller beforehand.
 */
interface IStakelessGaugeController {
    enum GaugeType { POLYGON, ARBITRUM, OPTIMISM }

    /**
    * @dev Registers an array of gauges from the given type.
    * @param gaugeType - Type of the gauge.
    * @param gauges - Gauges to register.
    */
    function addGauges(GaugeType gaugeType, IStakelessGauge[] calldata gauges) external;

    /**
    * @dev De-registers an array of gauges from the given type.
    * @param gaugeType - Type of the gauge.
    * @param gauges - Gauges to de-register.
    */
    function removeGauges(GaugeType gaugeType, IStakelessGauge[] calldata gauges) external;

    /**
    * @dev Returns true if the given gauge was registered for the given type; false otherwise.
    * @param gaugeType - Type of the gauge.
    * @param gauge - Gauge to check.
    */
    function hasGauge(GaugeType gaugeType, IStakelessGauge gauge) external view returns (bool);

    /**
    * @dev Returns the amount of registered gauges for a given type.
    * @param gaugeType - Type of the gauge.
    */
    function getTotalGauges(GaugeType gaugeType) external view returns (uint256);

    /**
    * @dev Returns the gauge of a given type at the given index.
    * Reverts if the index is greater than or equal to the amount of registered gauges for the given type.
    * @param gaugeType - Type of the gauge.
    * @param index - Index of the registered gauge.
    */
    function getGaugeAt(GaugeType gaugeType, uint256 index) external view returns (address);

    /**
    * @dev Performs a checkpoint for all registered gauges above the given relative weight threshold.
    * Reverts if the ETH sent in the call is not enough to cover bridge costs.
    * @param minRelativeWeight - Threshold to filter out gauges below it.
    */
    function checkpointGaugesAboveRelativeWeight(uint256 minRelativeWeight) external payable;
}
