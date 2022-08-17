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

import "./ComposableStablePool.sol";

contract ComposableStablePoolFactory is BasePoolFactory, FactoryWidePauseWindow {
    constructor(IVault vault, IProtocolFeePercentagesProvider protocolFeeProvider)
        BasePoolFactory(vault, protocolFeeProvider, type(ComposableStablePool).creationCode)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @dev Deploys a new `ComposableStablePool`.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 amplificationParameter,
        IRateProvider[] memory rateProviders,
        uint256[] memory tokenRateCacheDurations,
        bool[] memory exemptFromYieldProtocolFeeFlags,
        uint256 swapFeePercentage,
        address owner
    ) external returns (ComposableStablePool) {
        (uint256 pauseWindowDuration, uint256 bufferPeriodDuration) = getPauseConfiguration();
        return
            ComposableStablePool(
                _create(
                    abi.encode(
                        ComposableStablePool.NewPoolParams({
                            vault: getVault(),
                            protocolFeeProvider: getProtocolFeePercentagesProvider(),
                            name: name,
                            symbol: symbol,
                            tokens: tokens,
                            rateProviders: rateProviders,
                            tokenRateCacheDurations: tokenRateCacheDurations,
                            exemptFromYieldProtocolFeeFlags: exemptFromYieldProtocolFeeFlags,
                            amplificationParameter: amplificationParameter,
                            swapFeePercentage: swapFeePercentage,
                            pauseWindowDuration: pauseWindowDuration,
                            bufferPeriodDuration: bufferPeriodDuration,
                            owner: owner
                        })
                    )
                )
            );
    }
}
