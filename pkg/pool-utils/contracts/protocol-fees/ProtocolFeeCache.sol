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
 */
abstract contract ProtocolFeeCache is RecoveryMode {
    using SafeCast for uint256;

    IProtocolFeePercentagesProvider private immutable _protocolFeeProvider;
    uint256 private immutable _swapFeeId;
    uint256 private immutable _yieldFeeId;
    uint256 private immutable _aumFeeId;

    // Protocol Fee Percentages can never be larger than 100% (1e18), which fits in ~59 bits, so using 64 for each type
    // is sufficient.
    struct FeeTypeCache {
        uint64 swapFee;
        uint64 yieldFee;
        uint64 aumFee;
    }

    /**
     * @dev Protocol fee types can be set at contract creation. Fee IDs store which of the IDs in the protocol fee
     * provider shall be applied to its respective fee type (swap, yield, aum).
     * This is because some Pools may have different protocol fee values for the same type of underlying operation:
     * for example, Stable Pools might have a different swap protocol fee than Weighted Pools.
     * This module does not check at all that the chosen fee types have any sort of relation with the operation they're
     * assigned to: it is possible to e.g. set a Pool's swap protocol fee to equal the flash loan protocol fee.
     */
    struct ProviderFeeIDs {
        uint256 swap;
        uint256 yield;
        uint256 aum;
    }

    FeeTypeCache private _cache;

    event ProtocolFeePercentageCacheUpdated(FeeTypeCache feeCache);

    constructor(IProtocolFeePercentagesProvider protocolFeeProvider, ProviderFeeIDs memory providerFeeIDs) {
        _protocolFeeProvider = protocolFeeProvider;
        _swapFeeId = providerFeeIDs.swap;
        _yieldFeeId = providerFeeIDs.yield;
        _aumFeeId = providerFeeIDs.aum;

        _updateProtocolFeeCache(protocolFeeProvider, providerFeeIDs);
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
     * @notice Returns the provider fee ID for the given fee type.
     */
    function getProviderFeeId(uint256 feeType) public view returns (uint256) {
        if (feeType == ProtocolFeeType.SWAP) {
            return _swapFeeId;
        } else if (feeType == ProtocolFeeType.YIELD) {
            return _yieldFeeId;
        } else if (feeType == ProtocolFeeType.AUM) {
            return _aumFeeId;
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

        _updateProtocolFeeCache(
            _protocolFeeProvider,
            ProviderFeeIDs({ swap: _swapFeeId, yield: _yieldFeeId, aum: _aumFeeId })
        );
    }

    /**
     * @dev Override in derived contracts to perform some action before the cache is updated. This is typically relevant
     * to Pools that incur protocol debt between operations. To avoid altering the amount due retroactively, this debt
     * needs to be paid before the fee percentages change.
     */
    function _beforeProtocolFeeCacheUpdate() internal virtual {
        // solhint-disable-previous-line no-empty-blocks
    }

    function _updateProtocolFeeCache(IProtocolFeePercentagesProvider protocolFeeProvider, ProviderFeeIDs memory feeIds)
        private
    {
        uint256 swapFee = protocolFeeProvider.getFeeTypePercentage(feeIds.swap);
        uint256 yieldFee = protocolFeeProvider.getFeeTypePercentage(feeIds.yield);
        uint256 aumFee = protocolFeeProvider.getFeeTypePercentage(feeIds.aum);

        _cache = FeeTypeCache({
            swapFee: swapFee.toUint64(),
            yieldFee: yieldFee.toUint64(),
            aumFee: aumFee.toUint64()
        });
        emit ProtocolFeePercentageCacheUpdated(_cache);
    }
}
