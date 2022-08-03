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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAuthorizerAdaptor.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeAdder.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeController.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IStakelessGauge.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IStakelessGaugeController.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "./arbitrum/ArbitrumRootGauge.sol";

/**
 * @title Stakeless Gauge Controller
 * @notice Implements IStakelessGaugeController; refer to it for API documentation.
 */
contract StakelessGaugeController is IStakelessGaugeController, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;

    mapping(IGaugeAdder.GaugeType => EnumerableSet.AddressSet) private _gauges;
    IAuthorizerAdaptor private immutable _authorizerAdaptor;
    IGaugeController private immutable _gaugeController;
    IGaugeAdder private immutable _gaugeAdder;

    constructor(
        IAuthorizerAdaptor authorizerAdaptor,
        IGaugeController gaugeController,
        IGaugeAdder gaugeAdder
    ) {
        _authorizerAdaptor = authorizerAdaptor;
        _gaugeController = gaugeController;
        _gaugeAdder = gaugeAdder;
    }

    modifier gaugeTypeChecked(IGaugeAdder.GaugeType gaugeType) {
        require(_isValidGaugeType(gaugeType), "Unsupported gauge type");
        _;
    }

    /**
     * @dev See IStakelessGaugeController#addGauges.
     */
    function addGauges(IGaugeAdder.GaugeType gaugeType, IStakelessGauge[] calldata gauges)
        external
        override
        gaugeTypeChecked(gaugeType)
    {
        EnumerableSet.AddressSet storage gaugesForType = _gauges[gaugeType];

        for (uint256 i = 0; i < gauges.length; i++) {
            IStakelessGauge gauge = gauges[i];
            require(
                _gaugeAdder.isGaugeFromValidFactory(address(gauge), gaugeType),
                "Gauge does not come from valid factory"
            );
            require(_gaugeController.gauge_exists(address(gauge)), "Gauge does not exist in controller");
            require(!gauge.is_killed(), "Gauge was killed");
            require(gaugesForType.add(address(gauge)), "Gauge already present");
        }
        emit IStakelessGaugeController.GaugesAdded(gaugeType, gauges);
    }

    /**
     * @dev See IStakelessGaugeController#removeGauges.
     */
    function removeGauges(IGaugeAdder.GaugeType gaugeType, IStakelessGauge[] calldata gauges)
        external
        override
        gaugeTypeChecked(gaugeType)
    {
        EnumerableSet.AddressSet storage gaugesForType = _gauges[gaugeType];

        for (uint256 i = 0; i < gauges.length; i++) {
            IStakelessGauge gauge = gauges[i];
            require(gauge.is_killed(), "Gauge was not killed");
            require(gaugesForType.remove(address(gauge)), "Gauge not present");
        }
        emit IStakelessGaugeController.GaugesRemoved(gaugeType, gauges);
    }

    /**
     * @dev See IStakelessGaugeController#hasGauge.
     */
    function hasGauge(IGaugeAdder.GaugeType gaugeType, IStakelessGauge gauge)
        external
        view
        override
        gaugeTypeChecked(gaugeType)
        returns (bool)
    {
        return _gauges[gaugeType].contains(address(gauge));
    }

    /**
     * @dev See IStakelessGaugeController#getTotalGauges.
     */
    function getTotalGauges(IGaugeAdder.GaugeType gaugeType)
        external
        view
        override
        gaugeTypeChecked(gaugeType)
        returns (uint256)
    {
        return _gauges[gaugeType].length();
    }

    /**
     * @dev See IStakelessGaugeController#getGaugeAt.
     */
    function getGaugeAt(IGaugeAdder.GaugeType gaugeType, uint256 index)
        external
        view
        override
        gaugeTypeChecked(gaugeType)
        returns (address)
    {
        return _gauges[gaugeType].at(index);
    }

    /**
     * @dev See IStakelessGaugeController#checkpointGaugesAboveRelativeWeight.
     * Unspent ETH is sent back to sender.
     */
    function checkpointGaugesAboveRelativeWeight(uint256 minRelativeWeight) external payable override nonReentrant {
        (uint256 singleArbGaugeBridgeETH, uint256 totalArbBridgeETH) = _getArbitrumBridgeCosts();

        // solhint-disable-next-line not-rely-on-time
        uint256 currentPeriod = _roundDownTimestamp(block.timestamp);

        _checkpointGauges(IGaugeAdder.GaugeType.Polygon, minRelativeWeight, currentPeriod, 0);
        _checkpointGauges(IGaugeAdder.GaugeType.Arbitrum, minRelativeWeight, currentPeriod, singleArbGaugeBridgeETH);
        _checkpointGauges(IGaugeAdder.GaugeType.Optimism, minRelativeWeight, currentPeriod, 0);
        _checkpointGauges(IGaugeAdder.GaugeType.Gnosis, minRelativeWeight, currentPeriod, 0);
        _checkpointGauges(IGaugeAdder.GaugeType.ZKSync, minRelativeWeight, currentPeriod, 0);

        // transfer msg.value - total spent ETH back to sender.
        // _getArbitrumBridgeCosts ensures the difference is always positive.
        Address.sendValue(msg.sender, msg.value - totalArbBridgeETH);
    }

    /**
     * @dev Returns a tuple with the ETH cost to checkpoint an individual gauge, and the cost to checkpoint all gauges.
     * Reverts if the transaction does not have enough ETH to cover the total cost of the operation.
     */
    function _getArbitrumBridgeCosts() private view returns (uint256, uint256) {
        uint256 totalGauges = _gauges[IGaugeAdder.GaugeType.Arbitrum].length();
        if (totalGauges == 0) {
            return (0, 0);
        }
        EnumerableSet.AddressSet storage arbitrumGauges = _gauges[IGaugeAdder.GaugeType.Arbitrum];

        // We can do this cast safely because we check that the gauge was created from the ArbitrumRootGaugeFactory
        // when we added it to the address set.
        uint256 singleGaugeBridgeCost = ArbitrumRootGauge(arbitrumGauges.unchecked_at(0)).getTotalBridgeCost();
        uint256 totalArbETH = singleGaugeBridgeCost * arbitrumGauges.length();
        require(msg.value >= totalArbETH, "Not enough eth to cover arbitrum checkpoints");

        return (singleGaugeBridgeCost, totalArbETH);
    }

    /**
     * @dev Performs checkpoints for all gauges of the given type whose relative weight is at least the specified one.
     * @param gaugeType - Type of the gauges to checkpoint.
     * @param minRelativeWeight - Threshold to filter out gauges below it.
     * @param currentPeriod - Current block time rounded down to the start of the week.
     * @param costPerCheckpoint - Value in ETH to be spent for each gauge to checkpoint to cover bridging costs.
     * This method doesn't check whether the caller transferred enough ETH to cover the whole operation.
     */
    function _checkpointGauges(
        IGaugeAdder.GaugeType gaugeType,
        uint256 minRelativeWeight,
        uint256 currentPeriod,
        uint256 costPerCheckpoint
    ) private {
        uint256 totalGauges = _gauges[gaugeType].length();
        EnumerableSet.AddressSet storage gaugeAddressSet = _gauges[gaugeType];
        for (uint256 i = 0; i < totalGauges; ++i) {
            address gauge = gaugeAddressSet.unchecked_at(i);
            // Skip gauges that are below the threshold.
            if (_gaugeController.gauge_relative_weight(gauge, currentPeriod) < minRelativeWeight) {
                continue;
            }

            _authorizerAdaptor.performAction{ value: costPerCheckpoint }(
                gauge,
                abi.encodeWithSelector(IStakelessGauge.checkpoint.selector)
            );
        }
    }

    /**
     * @dev Rounds the provided timestamp down to the beginning of the current week (Thurs 00:00 UTC).
     */
    function _roundDownTimestamp(uint256 timestamp) private pure returns (uint256) {
        // Division by zero or overflows are impossible here.
        return (timestamp / 1 weeks) * 1 weeks;
    }

    /**
     * @dev Returns true if gauge type is Polygon, Arbitrum, Optimism, Gnosis or ZKSync; false otherwise.
     */
    function _isValidGaugeType(IGaugeAdder.GaugeType gaugeType) private pure returns (bool) {
        return
            uint8(gaugeType) >= uint8(IGaugeAdder.GaugeType.Polygon) &&
            uint8(gaugeType) <= uint8(IGaugeAdder.GaugeType.ZKSync);
    }
}
