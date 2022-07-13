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

import "../rates/PriceRateCache.sol";

contract MockPriceRateCache {
    bytes32 private _cache;

    function getRate() public view returns (uint256) {
        return PriceRateCache.getRate(_cache);
    }

    function getPostJoinExitRate() external view returns (uint256) {
        return PriceRateCache.getPostJoinExitRate(_cache);
    }

    function setPostJoinExitRate(uint256 rate) external returns (bytes32) {
        _cache = PriceRateCache.setPostJoinExitRate(_cache, rate);

        return _cache;
    }

    function getDuration() public view returns (uint256) {
        return PriceRateCache.getDuration(_cache);
    }

    function getTimestamps() public view returns (uint256 duration, uint256 expires) {
        return PriceRateCache.getTimestamps(_cache);
    }

    function encode(uint256 rate, uint256 duration) external returns (bytes32) {
        _cache = PriceRateCache.encode(rate, duration);

        return _cache;
    }

    function decode()
        external
        view
        returns (
            uint256 rate,
            uint256 duration,
            uint256 expires
        )
    {
        return PriceRateCache.decode(_cache);
    }
}
