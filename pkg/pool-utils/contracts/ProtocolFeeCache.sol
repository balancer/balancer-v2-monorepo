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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "./BasePool.sol";

abstract contract ProtocolFeeCache {
    // Matches ProtocolFeesCollector
    uint256 private constant _MAX_PROTOCOL_SWAP_FEE_PERCENTAGE = 50e16; // 50%

    uint256 public constant DELEGATE_PROTOCOL_FEES_SENTINEL = type(uint256).max;

    // Cache protocol swap fee percentage, since we need it on swaps, but it is not passed in then
    bool internal immutable _delegatedProtocolFees;
    IVault internal immutable _vault;

    // The Vault does not provide the protocol swap fee percentage in swap hooks (as swaps don't typically need this
    // value), so we need to fetch it ourselves from the Vault's ProtocolFeeCollector. However, this value changes so
    // rarely that it doesn't make sense to perform the required calls to get the current value in every single swap.
    // Instead, we keep a local copy that can be permissionlessly updated by anyone with the real value.
    uint256 private _cachedProtocolSwapFeePercentage;

    event CachedProtocolSwapFeePercentageUpdated(uint256 protocolSwapFeePercentage);

    constructor(IVault vault, uint256 protocolSwapFeePercentage) {
        // Set initial value of the protocolSwapFeePercentage; can be updated externally if it is delegated
        bool delegatedProtocolFees = protocolSwapFeePercentage == DELEGATE_PROTOCOL_FEES_SENTINEL;
        _delegatedProtocolFees = delegatedProtocolFees;
        _vault = vault;

        if (delegatedProtocolFees) {
            _updateCachedProtocolSwapFee(vault);
        } else {
            _require(
                protocolSwapFeePercentage <= _MAX_PROTOCOL_SWAP_FEE_PERCENTAGE,
                Errors.SWAP_FEE_PERCENTAGE_TOO_HIGH
            );

            // Set the fixed protocol fee percentage, which can be zero
            _cachedProtocolSwapFeePercentage = protocolSwapFeePercentage;

            emit CachedProtocolSwapFeePercentageUpdated(protocolSwapFeePercentage);
        }
    }

    function updateCachedProtocolSwapFeePercentage() external {
        if (getProtocolFeeDelegation()) {
            _updateCachedProtocolSwapFee(_vault);
        }
    }

    function getCachedProtocolSwapFeePercentage() public view returns (uint256) {
        return _cachedProtocolSwapFeePercentage;
    }

    function _updateCachedProtocolSwapFee(IVault vault) private {
        uint256 currentProtocolSwapFeePercentage = vault.getProtocolFeesCollector().getSwapFeePercentage();

        emit CachedProtocolSwapFeePercentageUpdated(currentProtocolSwapFeePercentage);

        _cachedProtocolSwapFeePercentage = currentProtocolSwapFeePercentage;
    }

    /**
     * @dev Returns whether the pool pays protocol fees.
     */
    function getProtocolFeeDelegation() public view returns (bool) {
        return _delegatedProtocolFees;
    }
}
