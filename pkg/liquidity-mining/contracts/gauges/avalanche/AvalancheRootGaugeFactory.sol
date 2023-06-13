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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IAvalancheBridgeLimitsProvider.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";

import "../BaseGaugeFactory.sol";
import "./AvalancheRootGauge.sol";

contract AvalancheRootGaugeFactory is IAvalancheBridgeLimitsProvider, BaseGaugeFactory, SingletonAuthentication {
    uint256 private _minBridgeAmount;
    uint256 private _maxBridgeAmount;

    event AvalancheBridgeLimitsModified(uint256 minBridgeAmount, uint256 maxBridgeAmount);

    constructor(
        IVault vault,
        IMainnetBalancerMinter minter,
        IMultichainV4Router multichainRouter,
        uint256 minBridgeAmount,
        uint256 maxBridgeAmount
    ) BaseGaugeFactory(address(new AvalancheRootGauge(minter, multichainRouter))) SingletonAuthentication(vault) {
        _minBridgeAmount = minBridgeAmount;
        _maxBridgeAmount = maxBridgeAmount;
    }

    /// @inheritdoc IAvalancheBridgeLimitsProvider
    function getAvalancheBridgeLimits()
        external
        view
        override
        returns (uint256 minBridgeAmount, uint256 maxBridgeAmount)
    {
        return (_minBridgeAmount, _maxBridgeAmount);
    }

    /**
     * @notice Deploys a new gauge which bridges all of its BAL allowance to a single recipient on Avalanche.
     * @dev Care must be taken to ensure that gauges deployed from this factory are suitable before they are added
     * to the GaugeController.
     * @param recipient The address to receive BAL minted from the gauge
     * @param relativeWeightCap The relative weight cap for the created gauge
     * @return The address of the deployed gauge
     */
    function create(address recipient, uint256 relativeWeightCap) external returns (address) {
        address gauge = _create();
        AvalancheRootGauge(gauge).initialize(recipient, relativeWeightCap);
        return gauge;
    }

    /// @inheritdoc IAvalancheBridgeLimitsProvider
    function setAvalancheBridgeLimits(uint256 minBridgeAmount, uint256 maxBridgeAmount) external override authenticate {
        require(maxBridgeAmount > minBridgeAmount, "Invalid Bridge Limits");

        _minBridgeAmount = minBridgeAmount;
        _maxBridgeAmount = maxBridgeAmount;

        emit AvalancheBridgeLimitsModified(minBridgeAmount, maxBridgeAmount);
    }
}
