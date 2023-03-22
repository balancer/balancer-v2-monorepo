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
import "./MockRecoveryRateProviderPool.sol";

contract MockRecoveryRateProviderPoolFactory is BasePoolFactory {
    uint256 private constant _INITIAL_PAUSE_WINDOW_DURATION = 90 days;
    uint256 private constant _BUFFER_PERIOD_DURATION = 30 days;

    constructor(IVault _vault, IProtocolFeePercentagesProvider protocolFeeProvider)
        BasePoolFactory(
            _vault,
            protocolFeeProvider,
            _INITIAL_PAUSE_WINDOW_DURATION,
            _BUFFER_PERIOD_DURATION,
            type(MockRecoveryRateProviderPool).creationCode
        )
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function create(IRateProvider[] memory rateProviders, bytes32 salt) external returns (address) {
        return _create(abi.encode(getVault(), rateProviders), salt);
    }
}
