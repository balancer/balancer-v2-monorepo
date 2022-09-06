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

import "../protocol-fees/ProtocolFeeCache.sol";
import "./MockRecoveryModeStorage.sol";

contract MockProtocolFeeCache is ProtocolFeeCache, MockRecoveryModeStorage {
    // We make the caller the owner and make all functions owner only, letting the deployer perform all permissioned
    // actions.
    constructor(IProtocolFeePercentagesProvider protocolFeeProvider, uint256 protocolSwapFeePercentage)
        Authentication(bytes32(uint256(address(this))))
        BasePoolAuthorization(msg.sender)
        ProtocolFeeCache(protocolFeeProvider, protocolSwapFeePercentage)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    event FeesInBeforeHook(uint256 swap, uint256 yield, uint256 aum);

    function _beforeProtocolFeeCacheUpdate() internal override {
        emit FeesInBeforeHook(
            getProtocolFeePercentageCache(ProtocolFeeType.SWAP),
            getProtocolFeePercentageCache(ProtocolFeeType.YIELD),
            getProtocolFeePercentageCache(ProtocolFeeType.AUM)
        );
    }

    function _isOwnerOnlyAction(bytes32) internal pure override returns (bool) {
        return true;
    }

    function _getAuthorizer() internal pure override returns (IAuthorizer) {
        return IAuthorizer(address(0));
    }
}
