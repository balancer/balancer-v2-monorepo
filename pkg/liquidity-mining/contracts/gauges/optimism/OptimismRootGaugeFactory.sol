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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";

import "../BaseGaugeFactory.sol";
import "./OptimismRootGauge.sol";

contract OptimismRootGaugeFactory is IOptimismGasLimitProvider, BaseGaugeFactory, SingletonAuthentication {
    uint32 private _gasLimit;

    event OptimismGasLimitModified(uint256 gasLimit);

    constructor(
        IVault vault,
        IMainnetBalancerMinter minter,
        IL1StandardBridge optimismL1StandardBridge,
        address optimismBal,
        uint32 gasLimit
    )
        BaseGaugeFactory(address(new OptimismRootGauge(minter, optimismL1StandardBridge, optimismBal)))
        SingletonAuthentication(vault)
    {
        _gasLimit = gasLimit;
    }

    /**
     * @notice Returns the gas limit for the Optimism side of the bridging transaction
     */
    function getOptimismGasLimit() external view override returns (uint32) {
        return _gasLimit;
    }

    /**
     * @notice Deploys a new gauge which bridges all of its BAL allowance to a single recipient on Optimism.
     * @dev Care must be taken to ensure that gauges deployed from this factory are
     * suitable before they are added to the GaugeController.
     * @param recipient The address to receive BAL minted from the gauge
     * @param relativeWeightCap The relative weight cap for the created gauge
     * @return The address of the deployed gauge
     */
    function create(address recipient, uint256 relativeWeightCap) external returns (address) {
        address gauge = _create();
        OptimismRootGauge(gauge).initialize(recipient, relativeWeightCap);
        return gauge;
    }

    /**
     * @notice Set the gas limit for the Optimism side of the bridging transaction
     */
    function setOptimismGasLimit(uint32 gasLimit) external override authenticate {
        _gasLimit = gasLimit;
        emit OptimismGasLimitModified(gasLimit);
    }
}
