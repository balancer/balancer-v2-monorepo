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

import "@balancer-labs/v2-pool-utils/contracts/factories/BasePoolFactory.sol";
import "@balancer-labs/v2-pool-utils/contracts/factories/FactoryWidePauseWindow.sol";

import "./WeightedPool.sol";

contract WeightedPoolFactory is BasePoolFactory, FactoryWidePauseWindow {
    constructor(
        IVault vault,
        IProtocolFeePercentagesProvider protocolFeeProvider,
        string memory factoryVersion,
        string memory poolVersion
    ) BasePoolFactory(vault, protocolFeeProvider, type(WeightedPool).creationCode, factoryVersion, poolVersion) {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Deploys a new `WeightedPool`.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
        IRateProvider[] memory rateProviders,
        uint256 swapFeePercentage,
        address owner
    ) external returns (address) {
        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();

        return
            _create(
                abi.encode(
                    IBasePool.BasePoolParams({
                        vault: getVault(),
                        name: name,
                        symbol: symbol,
                        pauseWindowDuration: pauseWindowDuration,
                        bufferPeriodDuration: bufferPeriodDuration,
                        owner: owner,
                        version: getPoolVersion()
                    }),
                    WeightedPool.NewPoolParams({
                        protocolFeeProvider: getProtocolFeePercentagesProvider(),
                        tokens: tokens,
                        normalizedWeights: normalizedWeights,
                        rateProviders: rateProviders,
                        assetManagers: new address[](tokens.length), // Don't allow asset managers,
                        swapFeePercentage: swapFeePercentage
                    })
                )
            );
    }
}
