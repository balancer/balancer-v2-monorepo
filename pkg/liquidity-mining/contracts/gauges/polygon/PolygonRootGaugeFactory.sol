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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ISingleRecipientGaugeFactory.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Clones.sol";

import "./PolygonRootGauge.sol";

contract PolygonRootGaugeFactory is ISingleRecipientGaugeFactory {
    ISingleRecipientGauge private _gaugeImplementation;

    mapping(address => bool) private _isGaugeFromFactory;
    mapping(address => address) private _recipientGauge;

    event PolygonRootGaugeCreated(address indexed gauge, address indexed recipient);

    constructor(
        IBalancerMinter minter,
        IPolygonRootChainManager polygonRootChainManager,
        address polygonERC20Predicate
    ) {
        _gaugeImplementation = new PolygonRootGauge(minter, polygonRootChainManager, polygonERC20Predicate);
    }

    /**
     * @notice Returns the address of the implementation used for gauge deployments.
     */
    function getGaugeImplementation() public view returns (ISingleRecipientGauge) {
        return _gaugeImplementation;
    }

    /**
     * @notice Returns true if `gauge` was created by this factory.
     */
    function isGaugeFromFactory(address gauge) external view override returns (bool) {
        return _isGaugeFromFactory[gauge];
    }

    /**
     * @notice Returns the gauge which sends funds to `recipient`.
     */
    function getRecipientGauge(address recipient) external view override returns (ILiquidityGauge) {
        return ILiquidityGauge(_recipientGauge[recipient]);
    }

    /**
     * @notice Returns the recipient of `gauge`.
     */
    function getGaugeRecipient(address gauge) external view override returns (address) {
        return ISingleRecipientGauge(gauge).getRecipient();
    }

    /**
     * @notice Deploys a new gauge which bridges all of its BAL allowance to a single recipient on Polygon.
     * @dev Care must be taken to ensure that gauges deployed from this factory are
     * suitable before they are added to the GaugeController.
     * @param recipient The address to receive BAL minted from the gauge
     * @return The address of the deployed gauge
     */
    function create(address recipient) external override returns (address) {
        require(_recipientGauge[recipient] == address(0), "Gauge already exists");

        address gauge = Clones.clone(address(_gaugeImplementation));

        ISingleRecipientGauge(gauge).initialize(recipient);

        _isGaugeFromFactory[gauge] = true;
        _recipientGauge[recipient] = gauge;
        emit PolygonRootGaugeCreated(gauge, recipient);

        return gauge;
    }
}
