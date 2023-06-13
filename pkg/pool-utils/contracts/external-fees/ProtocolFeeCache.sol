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

import "@balancer-labs/v2-interfaces/contracts/pool-utils/IProtocolFeeCache.sol";
import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IProtocolFeePercentagesProvider.sol";

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeCast.sol";

import "../lib/VaultReentrancyLib.sol";
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
abstract contract ProtocolFeeCache is IProtocolFeeCache, RecoveryMode {
    using SafeCast for uint256;
    using WordCodec for bytes32;

    // Protocol Fee IDs represent fee types; we are supporting 3 types (join, yield and aum), so 8 bits is enough to
    // store each of them.
    // [ 232 bits |   8 bits   |    8 bits    |    8 bits   ]
    // [  unused  | AUM fee ID | Yield fee ID | Swap fee ID ]
    // [MSB                                              LSB]
    uint256 private constant _FEE_TYPE_ID_WIDTH = 8;
    uint256 private constant _SWAP_FEE_ID_OFFSET = 0;
    uint256 private constant _YIELD_FEE_ID_OFFSET = _SWAP_FEE_ID_OFFSET + _FEE_TYPE_ID_WIDTH;
    uint256 private constant _AUM_FEE_ID_OFFSET = _YIELD_FEE_ID_OFFSET + _FEE_TYPE_ID_WIDTH;

    // Protocol Fee Percentages can never be larger than 100% (1e18), which fits in ~59 bits, so using 64 for each type
    // is sufficient.
    // [  64 bits |    64 bits    |     64 bits     |     64 bits    ]
    // [  unused  | AUM fee cache | Yield fee cache | Swap fee cache ]
    // [MSB                                                       LSB]
    uint256 private constant _FEE_TYPE_CACHE_WIDTH = 64;
    uint256 private constant _SWAP_FEE_OFFSET = 0;
    uint256 private constant _YIELD_FEE_OFFSET = _SWAP_FEE_OFFSET + _FEE_TYPE_CACHE_WIDTH;
    uint256 private constant _AUM_FEE_OFFSET = _YIELD_FEE_OFFSET + _FEE_TYPE_CACHE_WIDTH;

    event ProtocolFeePercentageCacheUpdated(bytes32 feeCache);

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

    IProtocolFeePercentagesProvider private immutable _protocolFeeProvider;
    bytes32 private immutable _feeIds;

    bytes32 private _feeCache;

    constructor(IProtocolFeePercentagesProvider protocolFeeProvider, ProviderFeeIDs memory providerFeeIDs) {
        _protocolFeeProvider = protocolFeeProvider;

        bytes32 feeIds = WordCodec.encodeUint(providerFeeIDs.swap, _SWAP_FEE_ID_OFFSET, _FEE_TYPE_ID_WIDTH) |
            WordCodec.encodeUint(providerFeeIDs.yield, _YIELD_FEE_ID_OFFSET, _FEE_TYPE_ID_WIDTH) |
            WordCodec.encodeUint(providerFeeIDs.aum, _AUM_FEE_ID_OFFSET, _FEE_TYPE_ID_WIDTH);

        _feeIds = feeIds;

        _updateProtocolFeeCache(protocolFeeProvider, feeIds);
    }

    /**
     * @notice Returns the cached protocol fee percentage.
     */
    function getProtocolFeePercentageCache(uint256 feeType) public view returns (uint256) {
        if (inRecoveryMode()) {
            return 0;
        }

        uint256 offset;
        if (feeType == ProtocolFeeType.SWAP) {
            offset = _SWAP_FEE_OFFSET;
        } else if (feeType == ProtocolFeeType.YIELD) {
            offset = _YIELD_FEE_OFFSET;
        } else if (feeType == ProtocolFeeType.AUM) {
            offset = _AUM_FEE_OFFSET;
        } else {
            _revert(Errors.UNHANDLED_FEE_TYPE);
        }

        return _feeCache.decodeUint(offset, _FEE_TYPE_CACHE_WIDTH);
    }

    /**
     * @notice Returns the provider fee ID for the given fee type.
     */
    function getProviderFeeId(uint256 feeType) public view returns (uint256) {
        uint256 offset;

        if (feeType == ProtocolFeeType.SWAP) {
            offset = _SWAP_FEE_ID_OFFSET;
        } else if (feeType == ProtocolFeeType.YIELD) {
            offset = _YIELD_FEE_ID_OFFSET;
        } else if (feeType == ProtocolFeeType.AUM) {
            offset = _AUM_FEE_ID_OFFSET;
        } else {
            _revert(Errors.UNHANDLED_FEE_TYPE);
        }

        return _feeIds.decodeUint(offset, _FEE_TYPE_ID_WIDTH);
    }

    /// @inheritdoc IProtocolFeeCache
    function updateProtocolFeePercentageCache() external override {
        VaultReentrancyLib.ensureNotInVaultContext(_getVault());

        _beforeProtocolFeeCacheUpdate();

        _updateProtocolFeeCache(_protocolFeeProvider, _feeIds);
    }

    /**
     * @dev Override in derived contracts to perform some action before the cache is updated. This is typically relevant
     * to Pools that incur protocol debt between operations. To avoid altering the amount due retroactively, this debt
     * needs to be paid before the fee percentages change.
     */
    function _beforeProtocolFeeCacheUpdate() internal virtual {
        // solhint-disable-previous-line no-empty-blocks
    }

    function _updateProtocolFeeCache(IProtocolFeePercentagesProvider protocolFeeProvider, bytes32 feeIds) private {
        uint256 swapFee = protocolFeeProvider.getFeeTypePercentage(
            feeIds.decodeUint(_SWAP_FEE_ID_OFFSET, _FEE_TYPE_ID_WIDTH)
        );
        uint256 yieldFee = protocolFeeProvider.getFeeTypePercentage(
            feeIds.decodeUint(_YIELD_FEE_ID_OFFSET, _FEE_TYPE_ID_WIDTH)
        );
        uint256 aumFee = protocolFeeProvider.getFeeTypePercentage(
            feeIds.decodeUint(_AUM_FEE_ID_OFFSET, _FEE_TYPE_ID_WIDTH)
        );

        bytes32 feeCache = WordCodec.encodeUint(swapFee, _SWAP_FEE_OFFSET, _FEE_TYPE_CACHE_WIDTH) |
            WordCodec.encodeUint(yieldFee, _YIELD_FEE_OFFSET, _FEE_TYPE_CACHE_WIDTH) |
            WordCodec.encodeUint(aumFee, _AUM_FEE_OFFSET, _FEE_TYPE_CACHE_WIDTH);

        _feeCache = feeCache;

        emit ProtocolFeePercentageCacheUpdated(feeCache);
    }
}
