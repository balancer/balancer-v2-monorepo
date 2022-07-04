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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "./RecoveryMode.sol";

/**
 * @title Store a fixed or cache the delegated Protocol Swap Fee Percentage
 * @author Balancer Labs
 * @dev The Vault does not provide the protocol swap fee percentage in swap hooks (as swaps don't typically need this
 * value), so we need to fetch it ourselves from the Vault's ProtocolFeeCollector. However, this value changes so
 * rarely that it doesn't make sense to perform the required calls to get the current value in every single swap.
 * Instead, we keep a local copy that can be permissionlessly updated by anyone with the real value.
 *
 * When initialized with the sentinel value, the fee is delegated, meaning the mutable protocol swap fee cache is
 * set to the current value stored in the Vault's ProtocolFeeCollector, and can be updated by anyone with a call to
 * `updateProtocolSwapFeePercentageCache`. Any other value means the protocol swap fee is fixed, so it is instead
 * stored in the immutable `_fixedProtocolSwapFeePercentage`.
 */
abstract contract ProtocolFeeCache is RecoveryMode {
    uint256 public constant DELEGATE_PROTOCOL_FEES_SENTINEL = type(uint256).max;

    // Matches ProtocolFeesCollector
    uint256 private constant _MAX_PROTOCOL_SWAP_FEE_PERCENTAGE = 50e16; // 50%

    bool private immutable _delegatedProtocolFees;

    // Only valid when `_delegatedProtocolFees` is false
    uint256 private immutable _fixedProtocolSwapFeePercentage;

    // Note that this value is immutable in the Vault, so we can make it immutable here and save gas
    IProtocolFeesCollector private immutable _protocolFeesCollector;

    uint256 private _protocolSwapFeePercentageCache;

    event ProtocolSwapFeePercentageCacheUpdated(uint256 protocolSwapFeePercentage);

    constructor(IVault vault, uint256 protocolSwapFeePercentage) {
        // Protocol fees are delegated to the value reported by the Fee Collector if the sentinel value is passed.
        bool delegatedProtocolFees = protocolSwapFeePercentage == DELEGATE_PROTOCOL_FEES_SENTINEL;

        _delegatedProtocolFees = delegatedProtocolFees;

        IProtocolFeesCollector protocolFeesCollector = vault.getProtocolFeesCollector();
        _protocolFeesCollector = protocolFeesCollector;

        if (delegatedProtocolFees) {
            _updateProtocolSwapFeeCache(protocolFeesCollector);
        } else {
            _require(
                protocolSwapFeePercentage <= _MAX_PROTOCOL_SWAP_FEE_PERCENTAGE,
                Errors.SWAP_FEE_PERCENTAGE_TOO_HIGH
            );

            // We cannot set `_fixedProtocolSwapFeePercentage` here due to it being immutable so instead we must set it
            // in the main function scope with a value based on whether protocol fees are delegated.

            // Emit an event as we do in `_updateProtocolSwapFeeCache` to appear the same to offchain indexers.
            emit ProtocolSwapFeePercentageCacheUpdated(protocolSwapFeePercentage);
        }

        // As `_fixedProtocolSwapFeePercentage` is immutable we must set a value, but just set to zero if it's not used.
        _fixedProtocolSwapFeePercentage = delegatedProtocolFees ? 0 : protocolSwapFeePercentage;
    }

    /**
     * @dev Returns the current protocol swap fee percentage. If `getProtocolFeeDelegation()` is false, this value is
     * immutable. Alternatively, it will track the global fee percentage set in the Fee Collector.
     */
    function getProtocolSwapFeePercentageCache() public view returns (uint256) {
        if (inRecoveryMode()) {
            return 0;
        } else {
            return getProtocolFeeDelegation() ? _protocolSwapFeePercentageCache : _fixedProtocolSwapFeePercentage;
        }
    }

    /**
     * @dev Can be called by anyone to update the cache swap fee percentage (when delegated).
     * Updates the cache to the latest value set by governance.
     */
    function updateProtocolSwapFeePercentageCache() external {
        _require(getProtocolFeeDelegation(), Errors.INVALID_OPERATION);

        _updateProtocolSwapFeeCache(_protocolFeesCollector);
    }

    /**
     * @dev Returns whether this Pool tracks protocol fee changes in the Fee Collector.
     */
    function getProtocolFeeDelegation() public view returns (bool) {
        return _delegatedProtocolFees;
    }

    function _updateProtocolSwapFeeCache(IProtocolFeesCollector protocolFeeCollector) private {
        uint256 currentProtocolSwapFeePercentage = protocolFeeCollector.getSwapFeePercentage();

        emit ProtocolSwapFeePercentageCacheUpdated(currentProtocolSwapFeePercentage);

        _protocolSwapFeePercentageCache = currentProtocolSwapFeePercentage;
    }
}
