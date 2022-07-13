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
 * [ 32 bits |  32 bits  |   96 bits  |   96 bits    ]
 * [ expires | duration  | last rate  | current rate ]
*  |MSB                                           LSB|
 *
 * 'rate' is an 18 decimal fixed point number, supporting rates of up to ~3e10. 'expires' is a Unix timestamp, and
 * 'duration' is expressed in seconds.
 */
library PriceRateCache {
    using WordCodec for bytes32;

    uint256 private constant _CURRENT_PRICE_RATE_OFFSET = 0;
    uint256 private constant _POST_JOINEXIT_RATE_OFFSET = 96;
    uint256 private constant _PRICE_RATE_CACHE_DURATION_OFFSET = 192;
    uint256 private constant _PRICE_RATE_CACHE_EXPIRES_OFFSET = 224;

    /**
     * @dev Returns the current rate of a price rate cache.
     */
    function getRate(bytes32 cache) internal pure returns (uint256) {
        return cache.decodeUint(_CURRENT_PRICE_RATE_OFFSET, 96);
    }

    /**
     * @dev Returns the current rate of a price rate cache.
     */
    function getPostJoinExitRate(bytes32 cache) internal pure returns (uint256) {
        return cache.decodeUint(_POST_JOINEXIT_RATE_OFFSET, 96);
    }

    /**
     * @dev Returns the duration of a price rate cache.
     */
    function getDuration(bytes32 cache) internal pure returns (uint256) {
        return cache.decodeUint(_PRICE_RATE_CACHE_DURATION_OFFSET, 32);
    }

    /**
     * @dev Returns the duration and expiration time of a price rate cache.
     */
    function getTimestamps(bytes32 cache) internal pure returns (uint256 duration, uint256 expires) {
        duration = getDuration(cache);
        expires = cache.decodeUint(_PRICE_RATE_CACHE_EXPIRES_OFFSET, 32);
    }

    /**
     * @dev Encodes rate and duration into a price rate cache. The expiration time is computed automatically, counting
     * from the current time.
     */
    function encode(uint256 rate, uint256 duration) internal view returns (bytes32) {
        _require(rate >> 96 == 0, Errors.PRICE_RATE_OVERFLOW);

        // solhint-disable not-rely-on-time
        return
            WordCodec.encodeUint(rate, _CURRENT_PRICE_RATE_OFFSET, 96) |
            WordCodec.encodeUint(duration, _PRICE_RATE_CACHE_DURATION_OFFSET, 32) |
            WordCodec.encodeUint(block.timestamp + duration, _PRICE_RATE_CACHE_EXPIRES_OFFSET, 32);
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
