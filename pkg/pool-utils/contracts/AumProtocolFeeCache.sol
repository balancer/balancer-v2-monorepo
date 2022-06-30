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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IAumProtocolFeesCollector.sol";

/**
 * @title Store a cached Protocol AUM Fee Percentage
 * @author Balancer Labs
 * @dev Unanticipated by the Vault, the AUM protocol fee is stored in a separate Singleton contract,
 * deployed by the BaseManagedPoolFactory.
 */
abstract contract AumProtocolFeeCache {
    IAumProtocolFeesCollector private immutable _aumProtocolFeesCollector;

    uint256 private _protocolAumFeePercentageCache;

    event ProtocolAumFeePercentageCacheUpdated(uint256 protocolAumFeePercentage);

    constructor(IAumProtocolFeesCollector aumProtocolFeesCollector) {
        _aumProtocolFeesCollector = aumProtocolFeesCollector;

        _updateProtocolAumFeeCache(aumProtocolFeesCollector);
    }

    /**
     * @dev Returns the current protocol AUM fee percentage.
     */
    function getProtocolAumFeePercentageCache() public view returns (uint256) {
        return _protocolAumFeePercentageCache;
    }

    /**
     * @dev Can be called by anyone to update the cache AUM fee percentage.
     * Updates the cache to the latest value set by governance.
     */
    function updateProtocolAumFeePercentageCache() external {
        _updateProtocolAumFeeCache(_aumProtocolFeesCollector);
    }

    function _updateProtocolAumFeeCache(IAumProtocolFeesCollector aumProtocolFeeCollector) private {
        uint256 currentProtocolAumFeePercentage = aumProtocolFeeCollector.getAumFeePercentage();

        emit ProtocolAumFeePercentageCacheUpdated(currentProtocolAumFeePercentage);

        _protocolAumFeePercentageCache = currentProtocolAumFeePercentage;
    }
}
