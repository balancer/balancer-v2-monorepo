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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";

/**
 * Price rate caches are used to avoid querying the price rate for a token every time we need to work with it.
 * Data is stored with the following structure:
 *
 * [   expires   | duration | price rate value ]
 * [   uint64    |  uint64  |      uint128     ]
 */
library PriceRateCache {
    using WordCodec for bytes32;

    uint256 private constant _PRICE_RATE_CACHE_VALUE_OFFSET = 0;
    uint256 private constant _PRICE_RATE_CACHE_DURATION_OFFSET = 128;
    uint256 private constant _PRICE_RATE_CACHE_EXPIRES_OFFSET = 128 + 64;

    /**
     * @dev Decodes the rate value for a price rate cache
     */
    function getValue(bytes32 cache) internal pure returns (uint256) {
        return cache.decodeUint128(_PRICE_RATE_CACHE_VALUE_OFFSET);
    }

    /**
     * @dev Decodes the duration for a price rate cache
     */
    function getDuration(bytes32 cache) internal pure returns (uint256) {
        return cache.decodeUint64(_PRICE_RATE_CACHE_DURATION_OFFSET);
    }

    /**
     * @dev Decodes the duration and expiration timestamp for a price rate cache
     */
    function getTimestamps(bytes32 cache) internal pure returns (uint256 duration, uint256 expires) {
        duration = getDuration(cache);
        expires = cache.decodeUint64(_PRICE_RATE_CACHE_EXPIRES_OFFSET);
    }

    /**
     * @dev Fetches the current price rate from a provider and builds a new price rate cache
     */
    function encode(uint256 rate, uint256 duration) internal view returns (bytes32) {
        _require(rate < 2**128, Errors.PRICE_RATE_OVERFLOW);

        // solhint-disable not-rely-on-time
        return
            WordCodec.encodeUint(uint128(rate), _PRICE_RATE_CACHE_VALUE_OFFSET) |
            WordCodec.encodeUint(uint64(duration), _PRICE_RATE_CACHE_DURATION_OFFSET) |
            WordCodec.encodeUint(uint64(block.timestamp + duration), _PRICE_RATE_CACHE_EXPIRES_OFFSET);
    }

    /**
     * @dev Decodes a price rate cache into rate value, duration and expiration time
     */
    function decode(bytes32 cache)
        internal
        pure
        returns (
            uint256 rate,
            uint256 duration,
            uint256 expires
        )
    {
        rate = getValue(cache);
        (duration, expires) = getTimestamps(cache);
    }
}
