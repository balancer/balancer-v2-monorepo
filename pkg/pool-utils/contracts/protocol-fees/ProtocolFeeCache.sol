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
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolFeePercentagesProvider.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeCast.sol";

import "../RecoveryMode.sol";

/**
 * @dev The Vault does not provide the protocol swap fee percentage in swap hooks (as swaps don't typically need this
 * value), so for swaps that need this value, we would have to to fetch it ourselves from the
 * ProtocolFeePercentagesProvider. Additionally, other protocol fee types (such as Yield or AUM) can only be obtained
 * by making said call.
 *
 * However, these values change so rarely that it doesn't make sense to perform the required calls to get the current
 * values in every single user interaction. Instead, we keep a local copy that can be permissionlessly updated by anyone
 * with the real value. We also pack these values together, performing a single storage read to get them all.
 *
 * When initialized with a special sentinel value, the swap fee is delegated, meaning the mutable protocol swap fee
 * cache is set to the current value stored in the ProtocolFeePercentagesProvider, and can be updated by anyone with a
 * call to `updateProtocolFeePercentageCache`. Any other value means the protocol swap fee is fixed, so it is instead
 * stored in the immutable `_fixedProtocolSwapFeePercentage`.
 */
abstract contract ProtocolFeeCache is RecoveryMode {
    using SafeCast for uint256;

    IProtocolFeePercentagesProvider private immutable _protocolFeeProvider;

    // Protocol Fee Percentages can never be larger than 100% (1e18), which fits in ~59 bits, so using 64 for each type
    // is sufficient.
    struct FeeTypeCache {
        uint64 swapFee;
        uint64 yieldFee;
        uint64 aumFee;
    }

    FeeTypeCache private _cache;

    event ProtocolFeePercentageCacheUpdated(uint256 indexed feeType, uint256 protocolFeePercentage);

    constructor(IProtocolFeePercentagesProvider protocolFeeProvider) {
        _protocolFeeProvider = protocolFeeProvider;

        _updateProtocolFeeCache(protocolFeeProvider, ProtocolFeeType.SWAP);
        _updateProtocolFeeCache(protocolFeeProvider, ProtocolFeeType.YIELD);
        _updateProtocolFeeCache(protocolFeeProvider, ProtocolFeeType.AUM);
    }

    /**
     * @notice Returns the cached protocol fee percentage.
     */
    function getProtocolFeePercentageCache(uint256 feeType) public view returns (uint256) {
        if (inRecoveryMode()) {
            return 0;
        }

        if (feeType == ProtocolFeeType.SWAP) {
            return _cache.swapFee;
        } else if (feeType == ProtocolFeeType.YIELD) {
            return _cache.yieldFee;
        } else if (feeType == ProtocolFeeType.AUM) {
            return _cache.aumFee;
        } else {
            _revert(Errors.UNHANDLED_FEE_TYPE);
        }
    }

    /**
     * @notice Updates the cache to the latest value set by governance.
     * @dev Can be called by anyone to update the cached fee percentages.
     */
    function updateProtocolFeePercentageCache() external {
        _beforeProtocolFeeCacheUpdate();

        _updateProtocolFeeCache(_protocolFeeProvider, ProtocolFeeType.SWAP);
        _updateProtocolFeeCache(_protocolFeeProvider, ProtocolFeeType.YIELD);
        _updateProtocolFeeCache(_protocolFeeProvider, ProtocolFeeType.AUM);
    }

    /**
     * @dev Override in derived contracts to perform some action before the cache is updated. This is typically relevant
     * to Pools that incur protocol debt between operations. To avoid altering the amount due retroactively, this debt
     * needs to be paid before the fee percentages change.
     */
    function _beforeProtocolFeeCacheUpdate() internal virtual {
        // solhint-disable-previous-line no-empty-blocks
    }

    function _updateProtocolFeeCache(IProtocolFeePercentagesProvider protocolFeeProvider, uint256 feeType) private {
        uint256 currentValue = protocolFeeProvider.getFeeTypePercentage(feeType);

        if (feeType == ProtocolFeeType.SWAP) {
            _cache.swapFee = currentValue.toUint64();
        } else if (feeType == ProtocolFeeType.YIELD) {
            _cache.yieldFee = currentValue.toUint64();
        } else if (feeType == ProtocolFeeType.AUM) {
            _cache.aumFee = currentValue.toUint64();
        } else {
            _revert(Errors.UNHANDLED_FEE_TYPE);
        }

        emit ProtocolFeePercentageCacheUpdated(feeType, currentValue);
    }
}
