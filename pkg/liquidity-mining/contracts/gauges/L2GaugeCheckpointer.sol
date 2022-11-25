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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAuthorizerAdaptorEntrypoint.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeAdder.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeController.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IL2GaugeCheckpointer.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IStakelessGauge.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "../admin/GaugeAdder.sol";
import "./arbitrum/ArbitrumRootGauge.sol";

/**
 * @title L2 Gauge Checkpointer
 * @notice Implements IL2GaugeCheckpointer; refer to it for API documentation.
 */
contract L2GaugeCheckpointer is IL2GaugeCheckpointer, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;

    mapping(IGaugeAdder.GaugeType => EnumerableSet.AddressSet) private _gauges;
    IAuthorizerAdaptorEntrypoint private immutable _authorizerAdaptorEntrypoint;
    IGaugeController private immutable _gaugeController;
    IGaugeAdder private immutable _gaugeAdder;

    constructor(IGaugeAdder gaugeAdder, IAuthorizerAdaptorEntrypoint authorizerAdaptorEntrypoint) {
        _gaugeAdder = gaugeAdder;
        _gaugeController = gaugeAdder.getGaugeController();
        _authorizerAdaptorEntrypoint = authorizerAdaptorEntrypoint;
    }

    modifier withSupportedGaugeType(IGaugeAdder.GaugeType gaugeType) {
        require(_isSupportedGaugeType(gaugeType), "Unsupported gauge type");
        _;
    }

    /**
     * @dev See `IL2GaugeCheckpointer#addGauges`.
     */
    function addGauges(IGaugeAdder.GaugeType gaugeType, IStakelessGauge[] calldata gauges)
        external
        override
        withSupportedGaugeType(gaugeType)
    {
        EnumerableSet.AddressSet storage gaugesForType = _gauges[gaugeType];

        for (uint256 i = 0; i < gauges.length; i++) {
            IStakelessGauge gauge = gauges[i];
            require(
                _gaugeAdder.isGaugeFromValidFactory(address(gauge), gaugeType),
                "Gauge does not come from a valid factory"
            );
            require(_gaugeController.gauge_exists(address(gauge)), "Gauge was not added to the GaugeController");
            require(!gauge.is_killed(), "Gauge was killed");
            require(gaugesForType.add(address(gauge)), "Gauge already added to the checkpointer");

            emit IL2GaugeCheckpointer.GaugeAdded(gaugeType, gauge);
        }
    }

    /**
     * @dev See `IL2GaugeCheckpointer#removeGauges`.
     */
    function removeGauges(IGaugeAdder.GaugeType gaugeType, IStakelessGauge[] calldata gauges)
        external
        override
        withSupportedGaugeType(gaugeType)
    {
        EnumerableSet.AddressSet storage gaugesForType = _gauges[gaugeType];

        for (uint256 i = 0; i < gauges.length; i++) {
            // Gauges added must come from a valid factory and exist in the controller, and they can't be removed from
            // them. Therefore, the only required check at this point is whether the gauge was killed.
            IStakelessGauge gauge = gauges[i];
            require(gauge.is_killed(), "Gauge was not killed");
            require(gaugesForType.remove(address(gauge)), "Gauge was not added to the checkpointer");

            emit IL2GaugeCheckpointer.GaugeRemoved(gaugeType, gauge);
        }
    }

    /**
     * @dev See `IL2GaugeCheckpointer#hasGauge`.
     */
    function hasGauge(IGaugeAdder.GaugeType gaugeType, IStakelessGauge gauge)
        external
        view
        override
        withSupportedGaugeType(gaugeType)
        returns (bool)
    {
        return _gauges[gaugeType].contains(address(gauge));
    }

    /**
     * @dev See `IL2GaugeCheckpointer#getTotalGauges`.
     */
    function getTotalGauges(IGaugeAdder.GaugeType gaugeType)
        external
        view
        override
        withSupportedGaugeType(gaugeType)
        returns (uint256)
    {
        return _gauges[gaugeType].length();
    }

    /**
     * @dev See `IL2GaugeCheckpointer#getGaugeAt`.
     */
    function getGaugeAt(IGaugeAdder.GaugeType gaugeType, uint256 index)
        external
        view
        override
        withSupportedGaugeType(gaugeType)
        returns (IStakelessGauge)
    {
        return IStakelessGauge(_gauges[gaugeType].at(index));
    }

    /**
     * @dev See `IL2GaugeCheckpointer#checkpointGaugesAboveRelativeWeight`.
     * Unspent ETH is sent back to sender.
     */
    function checkpointGaugesAboveRelativeWeight(uint256 minRelativeWeight) external payable override nonReentrant {
        // solhint-disable-next-line not-rely-on-time
        uint256 currentPeriod = _roundDownTimestamp(block.timestamp);

        _checkpointGauges(IGaugeAdder.GaugeType.Polygon, minRelativeWeight, currentPeriod);
        _checkpointGauges(IGaugeAdder.GaugeType.Arbitrum, minRelativeWeight, currentPeriod);
        _checkpointGauges(IGaugeAdder.GaugeType.Optimism, minRelativeWeight, currentPeriod);
        _checkpointGauges(IGaugeAdder.GaugeType.Gnosis, minRelativeWeight, currentPeriod);
        _checkpointGauges(IGaugeAdder.GaugeType.ZKSync, minRelativeWeight, currentPeriod);

        // Send back any leftover ETH to the caller.
        Address.sendValue(msg.sender, address(this).balance);
    }

    /**
     * @dev See `IL2GaugeCheckpointer#getTotalBridgeCost`.
     */
    function getTotalBridgeCost(uint256 minRelativeWeight) external view override returns (uint256) {
        // solhint-disable-next-line not-rely-on-time
        uint256 currentPeriod = _roundDownTimestamp(block.timestamp);
        uint256 totalArbitrumGauges = _gauges[IGaugeAdder.GaugeType.Arbitrum].length();
        EnumerableSet.AddressSet storage arbitrumGauges = _gauges[IGaugeAdder.GaugeType.Arbitrum];
        uint256 totalCost;

        for (uint256 i = 0; i < totalArbitrumGauges; ++i) {
            address gauge = arbitrumGauges.unchecked_at(i);
            // Skip gauges that are below the threshold.
            if (_gaugeController.gauge_relative_weight(gauge, currentPeriod) < minRelativeWeight) {
                continue;
            }

            // Cost per gauge is always the same, but getting the cost every time makes the code simpler,
            // and this function is only to be used off-chain.
            totalCost += ArbitrumRootGauge(gauge).getTotalBridgeCost();
        }
        return totalCost;
    }

    /**
     * @dev See `IL2GaugeCheckpointer#isSupportedGaugeType`.
     */
    function isSupportedGaugeType(IGaugeAdder.GaugeType gaugeType) external pure override returns (bool) {
        return _isSupportedGaugeType(gaugeType);
    }

    /**
     * @dev Performs checkpoints for all gauges of the given type whose relative weight is at least the specified one.
     * @param gaugeType - Type of the gauges to checkpoint.
     * @param minRelativeWeight - Threshold to filter out gauges below it.
     * @param currentPeriod - Current block time rounded down to the start of the week.
     * This method doesn't check whether the caller transferred enough ETH to cover the whole operation.
     */
    function _checkpointGauges(
        IGaugeAdder.GaugeType gaugeType,
        uint256 minRelativeWeight,
        uint256 currentPeriod
    ) private {
        uint256 totalTypeGauges = _gauges[gaugeType].length();
        if (totalTypeGauges == 0) {
            // Return early if there's no work to be done.
            return;
        }

        EnumerableSet.AddressSet storage typeGauges = _gauges[gaugeType];

        // We can do this cast safely because we check that the gauge was created from the ArbitrumRootGaugeFactory
        // when we added it to the address set. At this point, we have at least one gauge so unchecked_at(0) is valid.
        // Moreover, the cost per gauge is always the same, so we don't need to call the getter for the cost every time.
        uint256 costPerCheckpoint = gaugeType == IGaugeAdder.GaugeType.Arbitrum
            ? ArbitrumRootGauge(typeGauges.unchecked_at(0)).getTotalBridgeCost()
            : 0;

        for (uint256 i = 0; i < totalTypeGauges; ++i) {
            address gauge = typeGauges.unchecked_at(i);
            // Skip gauges that are below the threshold.
            if (_gaugeController.gauge_relative_weight(gauge, currentPeriod) < minRelativeWeight) {
                continue;
            }

            _authorizerAdaptorEntrypoint.performAction{ value: costPerCheckpoint }(
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

    function _isSupportedGaugeType(IGaugeAdder.GaugeType gaugeType) private pure returns (bool) {
        return
            gaugeType == IGaugeAdder.GaugeType.Polygon ||
            gaugeType == IGaugeAdder.GaugeType.Arbitrum ||
            gaugeType == IGaugeAdder.GaugeType.Optimism ||
            gaugeType == IGaugeAdder.GaugeType.Gnosis ||
            gaugeType == IGaugeAdder.GaugeType.ZKSync;
    }
}
