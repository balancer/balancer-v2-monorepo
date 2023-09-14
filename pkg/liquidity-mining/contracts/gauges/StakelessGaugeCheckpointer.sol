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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAuthorizerAdaptorEntrypoint.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeAdder.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IGaugeController.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IStakelessGauge.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IStakelessGaugeCheckpointer.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "../admin/GaugeAdder.sol";
import "./arbitrum/ArbitrumRootGauge.sol";

/**
 * @title Stakeless Gauge Checkpointer
 * @notice Implements IStakelessGaugeCheckpointer; refer to it for API documentation.
 */
contract StakelessGaugeCheckpointer is IStakelessGaugeCheckpointer, ReentrancyGuard, SingletonAuthentication {
    using EnumerableSet for EnumerableSet.AddressSet;

    mapping(string => EnumerableSet.AddressSet) private _gauges;
    IAuthorizerAdaptorEntrypoint private immutable _authorizerAdaptorEntrypoint;
    IGaugeAdder private immutable _gaugeAdder;
    IGaugeController private immutable _gaugeController;

    constructor(IGaugeAdder gaugeAdder, IAuthorizerAdaptorEntrypoint authorizerAdaptorEntrypoint)
        SingletonAuthentication(authorizerAdaptorEntrypoint.getVault())
    {
        _gaugeAdder = gaugeAdder;
        _authorizerAdaptorEntrypoint = authorizerAdaptorEntrypoint;
        _gaugeController = gaugeAdder.getGaugeController();
    }

    modifier withValidGaugeType(string memory gaugeType) {
        require(_gaugeAdder.isValidGaugeType(gaugeType), "Invalid gauge type");
        _;
    }

    modifier withValidGaugeTypes(string[] memory gaugeTypes) {
        for (uint256 i = 0; i < gaugeTypes.length; ++i) {
            require(_gaugeAdder.isValidGaugeType(gaugeTypes[i]), "Invalid gauge type");
        }
        _;
    }

    modifier withValidGauge(string memory gaugeType, IStakelessGauge gauge) {
        require(hasGauge(gaugeType, gauge), "Gauge not added");
        _;
    }

    modifier refundsEth() {
        _;
        _returnLeftoverEthIfAny();
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function getGaugeAdder() external view override returns (IGaugeAdder) {
        return _gaugeAdder;
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function getGaugeTypes() public view override returns (string[] memory) {
        return _gaugeAdder.getGaugeTypes();
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function addGaugesWithVerifiedType(string memory gaugeType, IStakelessGauge[] calldata gauges)
        external
        override
        withValidGaugeType(gaugeType)
        authenticate
    {
        // This is a permissioned call, so we can assume that the gauges' type matches the given one.
        // Therefore, we indicate `_addGauges` not to verify the gauge type.
        _addGauges(gaugeType, gauges, true);
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function addGauges(string memory gaugeType, IStakelessGauge[] calldata gauges)
        external
        override
        withValidGaugeType(gaugeType)
    {
        // Since everyone can call this method, the type needs to be verified in the internal `_addGauges` method.
        _addGauges(gaugeType, gauges, false);
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function removeGauges(string memory gaugeType, IStakelessGauge[] calldata gauges)
        external
        override
        withValidGaugeType(gaugeType)
    {
        EnumerableSet.AddressSet storage gaugesForType = _gauges[gaugeType];

        for (uint256 i = 0; i < gauges.length; i++) {
            // Gauges added must come from a valid factory and exist in the controller, and they can't be removed from
            // them. Therefore, the only required check at this point is whether the gauge was killed.
            IStakelessGauge gauge = gauges[i];
            require(gauge.is_killed(), "Gauge was not killed");
            require(gaugesForType.remove(address(gauge)), "Gauge was not added to the checkpointer");

            emit IStakelessGaugeCheckpointer.GaugeRemoved(gauge, gaugeType, gaugeType);
        }
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function hasGauge(string memory gaugeType, IStakelessGauge gauge)
        public
        view
        override
        withValidGaugeType(gaugeType)
        returns (bool)
    {
        return _gauges[gaugeType].contains(address(gauge));
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function getTotalGauges(string memory gaugeType)
        external
        view
        override
        withValidGaugeType(gaugeType)
        returns (uint256)
    {
        return _gauges[gaugeType].length();
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function getGaugeAtIndex(string memory gaugeType, uint256 index)
        external
        view
        override
        withValidGaugeType(gaugeType)
        returns (IStakelessGauge)
    {
        return IStakelessGauge(_gauges[gaugeType].at(index));
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function getRoundedDownBlockTimestamp() external view override returns (uint256) {
        return _roundDownBlockTimestamp();
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function checkpointAllGaugesAboveRelativeWeight(uint256 minRelativeWeight)
        external
        payable
        override
        nonReentrant
        refundsEth
    {
        string[] memory gaugeTypes = _gaugeAdder.getGaugeTypes();
        _checkpointGaugesAboveRelativeWeight(gaugeTypes, minRelativeWeight);
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function checkpointGaugesOfTypesAboveRelativeWeight(string[] memory gaugeTypes, uint256 minRelativeWeight)
        external
        payable
        override
        nonReentrant
        withValidGaugeTypes(gaugeTypes)
        refundsEth
    {
        _checkpointGaugesAboveRelativeWeight(gaugeTypes, minRelativeWeight);
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function checkpointSingleGauge(string memory gaugeType, IStakelessGauge gauge)
        external
        payable
        override
        nonReentrant
        withValidGauge(gaugeType, gauge)
        refundsEth
    {
        _checkpointSingleGauge(gauge);
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function checkpointMultipleGaugesOfMatchingType(string memory gaugeType, IStakelessGauge[] memory gauges)
        external
        payable
        override
        nonReentrant
        refundsEth
    {
        uint256 length = gauges.length;
        for (uint256 i = 0; i < length; ++i) {
            // The gauge type is also validated here.
            require(hasGauge(gaugeType, gauges[i]), "Gauge not added");

            _checkpointSingleGauge(gauges[i]);
        }
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function checkpointMultipleGauges(string[] memory gaugeTypes, IStakelessGauge[] memory gauges)
        external
        payable
        override
        nonReentrant
        refundsEth
    {
        require(gaugeTypes.length == gauges.length, "Mismatch between gauge types and addresses");

        uint256 length = gauges.length;
        for (uint256 i = 0; i < length; ++i) {
            // The gauge type is also validated here.
            require(hasGauge(gaugeTypes[i], gauges[i]), "Gauge not added");

            _checkpointSingleGauge(gauges[i]);
        }
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function getSingleBridgeCost(string memory gaugeType, IStakelessGauge gauge)
        external
        view
        override
        withValidGauge(gaugeType, gauge)
        returns (uint256)
    {
        return _getSingleBridgeCost(gauge);
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function getGaugeTypesBridgeCost(string[] memory gaugeTypes, uint256 minRelativeWeight)
        external
        view
        override
        withValidGaugeTypes(gaugeTypes)
        returns (uint256)
    {
        return _getGaugeTypesTotalBridgeCost(gaugeTypes, minRelativeWeight);
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function getTotalBridgeCost(uint256 minRelativeWeight) external view override returns (uint256) {
        string[] memory gaugeTypes = getGaugeTypes();
        return _getGaugeTypesTotalBridgeCost(gaugeTypes, minRelativeWeight);
    }

    /// @inheritdoc IStakelessGaugeCheckpointer
    function isValidGaugeType(string memory gaugeType) external view override returns (bool) {
        return _gaugeAdder.isValidGaugeType(gaugeType);
    }

    function _addGauges(
        string memory gaugeType,
        IStakelessGauge[] calldata gauges,
        bool isGaugeTypeVerified
    ) internal {
        EnumerableSet.AddressSet storage gaugesForType = _gauges[gaugeType];

        for (uint256 i = 0; i < gauges.length; i++) {
            IStakelessGauge gauge = gauges[i];
            // Gauges must come from a valid factory to be added to the gauge controller, so gauges that don't pass
            // the valid factory check will be rejected by the controller.
            require(_gaugeController.gauge_exists(address(gauge)), "Gauge was not added to the GaugeController");
            require(!gauge.is_killed(), "Gauge was killed");
            require(gaugesForType.add(address(gauge)), "Gauge already added to the checkpointer");

            // To ensure that the gauge effectively corresponds to the given type, we query the gauge factory registered
            // in the gauge adder for the gauge type.
            // However, since gauges may come from older factories from previous adders, we need to be able to override
            // this check. This way we can effectively still add older gauges to the checkpointer via authorized calls.
            require(
                isGaugeTypeVerified || _gaugeAdder.getFactoryForGaugeType(gaugeType).isGaugeFromFactory(address(gauge)),
                "Gauge does not correspond to the selected type"
            );

            emit IStakelessGaugeCheckpointer.GaugeAdded(gauge, gaugeType, gaugeType);
        }
    }

    /**
     * @dev Malicious contracts are ruled out at this stage: gauges shall be validated in external functions before
     * reaching this point.
     */
    function _getSingleBridgeCost(IStakelessGauge gauge) internal view returns (uint256) {
        // Some versions of the stakeless gauges did not implement this interface, so we need to try / catch the call.
        // In case the interface is not present, the cost is 0.
        try gauge.getTotalBridgeCost() returns (uint256 cost) {
            return cost;
        } catch {
            return 0;
        }
    }

    function _getGaugeTypeTotalBridgeCost(string memory gaugeType, uint256 minRelativeWeight)
        internal
        view
        returns (uint256 totalCost)
    {
        uint256 currentPeriod = _roundDownBlockTimestamp();
        uint256 gaugeCount = _gauges[gaugeType].length();
        EnumerableSet.AddressSet storage gauges = _gauges[gaugeType];

        for (uint256 i = 0; i < gaugeCount; ++i) {
            address gauge = gauges.unchecked_at(i);

            // The relative weight reported by the gauge controller is only valid if the gauge is updated (i.e. it
            // does not need a checkpoint in the controller).
            // It might be the case that after the checkpoint the gauge is below the weight threshold, but given
            // that we cannot perform the checkpoint in this view function we consider it within the threshold in that
            // case. It is better to overestimate the gas required for the call given that it is returned at the end
            // anyway.
            bool isGaugeUpdated = _gaugeController.time_weight(gauge) >= currentPeriod;
            if (isGaugeUpdated && _gaugeController.gauge_relative_weight(gauge, currentPeriod) < minRelativeWeight) {
                continue;
            }

            uint256 gaugeBridgeCost = _getSingleBridgeCost(IStakelessGauge(gauge));
            // If one gauge is costless, the same should apply for all the gauges of the same type.
            if (gaugeBridgeCost == 0) {
                break;
            }

            // Cost per gauge might not be the same if gauges come from different factories, so we add each
            // gauge's bridge cost individually.
            totalCost += gaugeBridgeCost;
        }
    }

    function _getGaugeTypesTotalBridgeCost(string[] memory gaugeTypes, uint256 minRelativeWeight)
        internal
        view
        returns (uint256 totalCost)
    {
        for (uint256 i = 0; i < gaugeTypes.length; ++i) {
            string memory gaugeType = gaugeTypes[i];
            totalCost += _getGaugeTypeTotalBridgeCost(gaugeType, minRelativeWeight);
        }
    }

    function _checkpointGaugesAboveRelativeWeight(string[] memory gaugeTypes, uint256 minRelativeWeight) internal {
        uint256 currentPeriod = _roundDownBlockTimestamp();

        for (uint256 i = 0; i < gaugeTypes.length; ++i) {
            _checkpointGauges(gaugeTypes[i], minRelativeWeight, currentPeriod);
        }
    }

    /**
     * @dev Performs checkpoints for all gauges of the given type whose relative weight is at least the specified one.
     * @param gaugeType Type of the gauges to checkpoint.
     * @param minRelativeWeight Threshold to filter out gauges below it.
     * @param currentPeriod Current block time rounded down to the start of the previous week.
     * This method doesn't check whether the caller transferred enough ETH to cover the whole operation.
     */
    function _checkpointGauges(
        string memory gaugeType,
        uint256 minRelativeWeight,
        uint256 currentPeriod
    ) private {
        EnumerableSet.AddressSet storage typeGauges = _gauges[gaugeType];

        uint256 totalTypeGauges = typeGauges.length();
        if (totalTypeGauges == 0) {
            // Return early if there's no work to be done.
            return;
        }

        // Most bridges are costless, and we can determine this by querying the cost of a single gauge.
        // If the cost of the first gauge in the list is 0, then it's 0 for the rest of them.
        // In that case, there's no need to query the bridge cost for every other gauge.
        // At this point we know there is at least one gauge in the set.
        bool isGaugeTypeCostless = (_getSingleBridgeCost(IStakelessGauge(typeGauges.unchecked_at(0))) == 0);

        // Arbitrum gauges need to send ETH when performing the checkpoint to pay for bridge costs. Furthermore,
        // if gauges come from different factories, the cost per gauge might not be the same for all gauges.
        function(IStakelessGauge) internal performCheckpoint = isGaugeTypeCostless
            ? _checkpointCostlessBridgeGauge
            : _checkpointPaidBridgeGauge;

        for (uint256 i = 0; i < totalTypeGauges; ++i) {
            address gauge = typeGauges.unchecked_at(i);

            // The gauge might need to be checkpointed in the controller to update its relative weight.
            // Otherwise it might be filtered out mistakenly.
            if (_gaugeController.time_weight(gauge) < currentPeriod) {
                _gaugeController.checkpoint_gauge(gauge);
            }

            // Skip gauges that are below the threshold.
            if (_gaugeController.gauge_relative_weight(gauge, currentPeriod) < minRelativeWeight) {
                continue;
            }

            performCheckpoint(IStakelessGauge(gauge));
        }
    }

    /**
     * @dev Calls `checkpoint` on a paid gauge, forwarding ETH to cover bridge costs.
     */
    function _checkpointPaidBridgeGauge(IStakelessGauge gauge) private {
        uint256 checkpointCost = gauge.getTotalBridgeCost();

        _authorizerAdaptorEntrypoint.performAction{ value: checkpointCost }(
            address(gauge),
            abi.encodeWithSelector(IStakelessGauge.checkpoint.selector)
        );
    }

    /**
     * @dev Calls `checkpoint` on a costless gauge; does not forward any ETH.
     */
    function _checkpointCostlessBridgeGauge(IStakelessGauge gauge) private {
        _authorizerAdaptorEntrypoint.performAction(
            address(gauge),
            abi.encodeWithSelector(IStakelessGauge.checkpoint.selector)
        );
    }

    /**
     * @dev Performs checkpoint for any gauge, attempting to get the cost beforehand.
     */
    function _checkpointSingleGauge(IStakelessGauge gauge) internal {
        uint256 checkpointCost = _getSingleBridgeCost(gauge);

        _authorizerAdaptorEntrypoint.performAction{ value: checkpointCost }(
            address(gauge),
            abi.encodeWithSelector(IStakelessGauge.checkpoint.selector)
        );
    }

    /**
     * @dev Send back any leftover ETH to the caller if there is an existing balance in the contract.
     */
    function _returnLeftoverEthIfAny() private {
        // Most gauge types don't need to send value, and this step can be skipped in those cases.
        uint256 remainingBalance = address(this).balance;
        if (remainingBalance > 0) {
            Address.sendValue(msg.sender, remainingBalance);
        }
    }

    /**
     * @dev Rounds the provided timestamp down to the beginning of the previous week (Thurs 00:00 UTC) with respect
     * to the current block timestamp.
     */
    function _roundDownBlockTimestamp() private view returns (uint256) {
        // Division by zero or overflows are impossible here.
        // solhint-disable-next-line not-rely-on-time
        return (block.timestamp / 1 weeks - 1) * 1 weeks;
    }
}
