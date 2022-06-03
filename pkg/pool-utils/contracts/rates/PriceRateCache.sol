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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

/**
 * Price rate caches are used to avoid querying the price rate for a token every time we need to work with it. It is
 * useful for slow changing rates, such as those that arise from interest-bearing tokens (e.g. waDAI into DAI).
 *
 * The cache data is packed into a single bytes32 value with the following structure:
 * [   expires   | duration | price rate value ]
 * [   uint64    |  uint64  |      uint128     ]
 * [ MSB                                   LSB ]
 *
 *
 * 'rate' is an 18 decimal fixed point number, supporting rates of up to ~3e20. 'expires' is a Unix timestamp, and
 * 'duration' is expressed in seconds.
 */
library PriceRateCache {
    using WordCodec for bytes32;

    uint256 private constant _PRICE_RATE_CACHE_VALUE_OFFSET = 0;
    uint256 private constant _PRICE_RATE_CACHE_DURATION_OFFSET = 128;
    uint256 private constant _PRICE_RATE_CACHE_EXPIRES_OFFSET = 128 + 64;

    /**
     * @dev Returns the rate of a price rate cache.
     */
    function getRate(bytes32 cache) internal pure returns (uint256) {
        return cache.decodeUint(_PRICE_RATE_CACHE_VALUE_OFFSET, 128);
    }

    /**
     * @dev Returns the duration of a price rate cache.
     */
    function getDuration(bytes32 cache) internal pure returns (uint256) {
        return cache.decodeUint(_PRICE_RATE_CACHE_DURATION_OFFSET, 64);
    }

    /**
     * @dev Returns the duration and expiration time of a price rate cache.
     */
    function getTimestamps(bytes32 cache) internal pure returns (uint256 duration, uint256 expires) {
        duration = getDuration(cache);
        expires = cache.decodeUint(_PRICE_RATE_CACHE_EXPIRES_OFFSET, 64);
    }

    /**
     * @dev Encodes rate and duration into a price rate cache. The expiration time is computed automatically, counting
     * from the current time.
     */
    function encode(uint256 rate, uint256 duration) internal view returns (bytes32) {
        _require(rate >> 128 == 0, Errors.PRICE_RATE_OVERFLOW);

        // solhint-disable not-rely-on-time
        return
            WordCodec.encodeUint(rate, _PRICE_RATE_CACHE_VALUE_OFFSET, 128) |
            WordCodec.encodeUint(duration, _PRICE_RATE_CACHE_DURATION_OFFSET, 64) |
            WordCodec.encodeUint(block.timestamp + duration, _PRICE_RATE_CACHE_EXPIRES_OFFSET, 64);
    }

    /**
     * @dev Returns rate, duration and expiration time of a price rate cache.
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
        rate = getRate(cache);
        (duration, expires) = getTimestamps(cache);
    }
}
