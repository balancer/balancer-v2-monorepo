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

import "../factories/BasePoolFactory.sol";
import "./MockFactoryCreatedPool.sol";

contract MockPoolFactory is BasePoolFactory {
    constructor(IVault _vault, IProtocolFeePercentagesProvider protocolFeeProvider, uint256 initialPauseWindowDuration, uint256 bufferPeriodDuration)
        BasePoolFactory(_vault, protocolFeeProvider, initialPauseWindowDuration, bufferPeriodDuration, type(MockFactoryCreatedPool).creationCode)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function create() external returns (address) {
        return _create("", "");
    }

    function getMaxPauseWindowDuration() external pure returns (uint256) {
        return PausableConstants.MAX_PAUSE_WINDOW_DURATION;
    }

    function getMaxBufferPeriodDuration() external pure returns (uint256) {
        return PausableConstants.MAX_BUFFER_PERIOD_DURATION;
    }
}
