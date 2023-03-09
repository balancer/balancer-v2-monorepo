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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";

import "../BaseGaugeFactory.sol";
import "./ArbitrumRootGauge.sol";

contract ArbitrumRootGaugeFactory is IArbitrumFeeProvider, BaseGaugeFactory, SingletonAuthentication {
    uint64 private _gasLimit;
    uint64 private _gasPrice;
    uint64 private _maxSubmissionCost;

    event ArbitrumFeesModified(uint256 gasLimit, uint256 gasPrice, uint256 maxSubmissionCost);

    constructor(
        IVault vault,
        IMainnetBalancerMinter minter,
        IGatewayRouter gatewayRouter,
        uint64 gasLimit,
        uint64 gasPrice,
        uint64 maxSubmissionCost
    ) BaseGaugeFactory(address(new ArbitrumRootGauge(minter, gatewayRouter))) SingletonAuthentication(vault) {
        _gasLimit = gasLimit;
        _gasPrice = gasPrice;
        _maxSubmissionCost = maxSubmissionCost;
    }

    /**
     * @notice Set the fees for the Arbitrum side of the bridging transaction
     */
    function getArbitrumFees()
        external
        view
        override
        returns (
            uint256 gasLimit,
            uint256 gasPrice,
            uint256 maxSubmissionCost
        )
    {
        gasLimit = _gasLimit;
        gasPrice = _gasPrice;
        maxSubmissionCost = _maxSubmissionCost;
    }

    /**
     * @notice Deploys a new gauge which bridges all of its BAL allowance to a single recipient on Arbitrum.
     * @dev Care must be taken to ensure that gauges deployed from this factory are
     * suitable before they are added to the GaugeController.
     * @param recipient The address to receive BAL minted from the gauge
     * @param relativeWeightCap The relative weight cap for the created gauge
     * @return The address of the deployed gauge
     */
    function create(address recipient, uint256 relativeWeightCap) external returns (address) {
        address gauge = _create();
        ArbitrumRootGauge(gauge).initialize(recipient, relativeWeightCap);
        return gauge;
    }

    /**
     * @notice Set the fees for the Arbitrum side of the bridging transaction
     */
    function setArbitrumFees(
        uint64 gasLimit,
        uint64 gasPrice,
        uint64 maxSubmissionCost
    ) external override authenticate {
        _gasLimit = gasLimit;
        _gasPrice = gasPrice;
        _maxSubmissionCost = maxSubmissionCost;
        emit ArbitrumFeesModified(gasLimit, gasPrice, maxSubmissionCost);
    }
}
