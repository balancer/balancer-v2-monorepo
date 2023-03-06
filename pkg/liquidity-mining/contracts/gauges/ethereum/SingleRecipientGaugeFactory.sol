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

import "../BaseGaugeFactory.sol";
import "./SingleRecipientGauge.sol";

contract SingleRecipientGaugeFactory is Version, BaseGaugeFactory {
    string private _productVersion;

    constructor(
        IMainnetBalancerMinter minter,
        string memory factoryVersion,
        string memory productVersion
    ) Version(factoryVersion) BaseGaugeFactory(address(new SingleRecipientGauge(minter))) {
        _productVersion = productVersion;
    }

    function getProductVersion() public view returns (string memory) {
        return _productVersion;
    }

    /**
     * @notice Deploys a new gauge which sends all of its BAL allowance to a single recipient.
     * @dev Care must be taken to ensure that gauges deployed from this factory are
     * suitable before they are added to the GaugeController.
     * @param recipient The address to receive BAL minted from the gauge
     * @param relativeWeightCap The relative weight cap for the created gauge
     * @param feeDistributorRecipient True if the recipient implements the IFeeDistributor interface and should receive
     * tokens via the `depositToken` function.
     * @return The address of the deployed gauge
     */
    function create(
        address recipient,
        uint256 relativeWeightCap,
        bool feeDistributorRecipient
    ) external returns (address) {
        address gauge = _create();
        SingleRecipientGauge(gauge).initialize(
            recipient,
            relativeWeightCap,
            feeDistributorRecipient,
            getProductVersion()
        );
        return gauge;
    }
}
