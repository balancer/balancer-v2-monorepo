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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IChildChainGauge.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/Version.sol";

import "./BaseGaugeFactory.sol";

contract ChildChainGaugeFactory is Version, BaseGaugeFactory {
    string private _productVersion;

    constructor(
        IChildChainGauge gaugeImplementation,
        string memory factoryVersion,
        string memory productVersion
    ) Version(factoryVersion) BaseGaugeFactory(address(gaugeImplementation)) {
        require(
            keccak256(abi.encodePacked(gaugeImplementation.version())) == keccak256(abi.encodePacked(productVersion)),
            "VERSION_MISMATCH"
        );
        _productVersion = productVersion;
    }

    /**
     * @notice Returns a JSON representation of the deployed gauge version containing name, version number and task ID.
     *
     * @dev This value will only be updated at factory creation time.
     */
    function getProductVersion() public view returns (string memory) {
        return _productVersion;
    }

    /**
     * @notice Deploys a new gauge for a Balancer pool.
     * @dev As anyone can register arbitrary Balancer pools with the Vault,
     * it's impossible to prove onchain that `pool` is a "valid" deployment.
     *
     * Care must be taken to ensure that gauges deployed from this factory are suitable to distribute rewards.
     *
     * It is possible to deploy multiple gauges for a single pool.
     * @param pool The address of the pool for which to deploy a gauge
     * @return The address of the deployed gauge
     */
    function create(address pool) external returns (address) {
        address gauge = _create();
        IChildChainGauge(gauge).initialize(pool, getProductVersion());
        return gauge;
    }
}
