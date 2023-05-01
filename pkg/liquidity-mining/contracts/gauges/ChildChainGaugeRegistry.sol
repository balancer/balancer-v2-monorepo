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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/ILiquidityGaugeFactory.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IChildChainGauge.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "../L2BalancerPseudoMinter.sol";

/**
 * @title ChildChainGaugeRegistry
 * @notice Registry for all child chain gauges.
 * This contract enables the addition and removal of child chain gauges to the registry.
 * Duplication is not permitted. Gauges are verified to be valid.
 */
contract ChildChainGaugeRegistry is SingletonAuthentication, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;

    L2BalancerPseudoMinter private immutable _l2BalancerPseudoMinter;
    ILiquidityGaugeFactory private immutable _liquidityGaugeFactory;

    EnumerableSet.AddressSet private _gauges;

    event GaugeAdded(IChildChainGauge indexed gauge);
    event GaugeRemoved(IChildChainGauge indexed gauge);

    /**
     * @notice Constructor initializes the ChildChainGaugeRegistry contract.
     * @param l2BalancerPseudoMinter The L2 Balancer pseudo minter.
     * @param liquidityGaugeFactory The liquidity gauge factory.
     */
    constructor(L2BalancerPseudoMinter l2BalancerPseudoMinter, ILiquidityGaugeFactory liquidityGaugeFactory)
        SingletonAuthentication(l2BalancerPseudoMinter.getVault())
    {
        _l2BalancerPseudoMinter = l2BalancerPseudoMinter;
        _liquidityGaugeFactory = liquidityGaugeFactory;
    }

    /**
     * @notice Add a gauge to the registry after validating its legitimacy.
     * @dev This function checks that the gauge's factory is registered with the L2BalancerPseudoMinter,
     * and that the gauge has been deployed from the registered factory. If these conditions are met,
     * the gauge is added to the registry, and a GaugeAdded event is emitted.
     * @param gauge The gauge to add to the registry.
     */
    function addGauge(IChildChainGauge gauge) external authenticate nonReentrant {
        // Check that the gauge is valid
        // 1. The gauge's factory is registered with the L2BalancerPseudoMinter
        // 2. The gauge is deployed from the registered factory
        ILiquidityGaugeFactory factory = gauge.factory();
        require(_l2BalancerPseudoMinter.isValidGaugeFactory(factory), "INVALID_GAUGE_FACTORY");
        require(factory.isGaugeFromFactory(address(gauge)), "GAUGE_NOT_FROM_FACTORY");

        require(_gauges.add(address(gauge)), "GAUGE_ALREADY_REGISTERED");

        emit GaugeAdded(gauge);
    }

    /**
     * @notice Remove a registered gauge from the registry and emit a GaugeRemoved event.
     * @dev If the gauge is not registered, the function reverts with a "GAUGE_NOT_REGISTERED" error.
     * Remove a gauge might affect the order of the remaining gauges.
     * @param gauge The gauge to remove from the registry.
     */
    function removeGauge(IChildChainGauge gauge) external authenticate {
        require(_gauges.remove(address(gauge)), "GAUGE_NOT_REGISTERED");

        emit GaugeRemoved(gauge);
    }

    /**
     * @notice Retrieve the total number of gauges registered in the registry.
     * @return The total number of registered gauges as a uint256.
     */
    function totalGauges() external view returns (uint256) {
        return _gauges.length();
    }

    /**
     * @notice Retrieve a list of gauges within the specified index range from the registry.
     * @param startIndex The starting index (inclusive) for retrieving gauges from the registry.
     * @param endIndex The ending index (exclusive) for retrieving gauges from the registry.
     * @return An array of IChildChainGauge containing the gauges within the specified index range.
     */
    function getGauges(uint256 startIndex, uint256 endIndex) external view returns (IChildChainGauge[] memory) {
        require(startIndex < endIndex, "INVALID_INDICES");
        require(endIndex <= _gauges.length(), "END_INDEX_OUT_OF_BOUNDS");

        uint256 size = endIndex - startIndex;
        IChildChainGauge[] memory slicedGauges = new IChildChainGauge[](size);

        for (uint256 i = 0; i < size; i++) {
            slicedGauges[i] = IChildChainGauge(_gauges.at(startIndex + i));
        }

        return slicedGauges;
    }
}
