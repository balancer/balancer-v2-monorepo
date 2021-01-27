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

pragma solidity ^0.7.1;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../math/FixedPoint.sol";

library Enumerable {
    using FixedPoint for uint256;

    function add(uint256[] memory self, uint256[] memory addends) internal pure returns (uint256[] memory results) {
        return map(self, FixedPoint.add, addends);
    }

    function sub(uint256[] memory self, uint256[] memory subtrahends) internal pure returns (uint256[] memory results) {
        return map(self, FixedPoint.sub, subtrahends);
    }

    function mul(uint256[] memory self, uint256 multiplier) internal pure returns (uint256[] memory) {
        return map(self, FixedPoint.mul, multiplier);
    }

    function div(uint256[] memory self, uint256 dividend) internal pure returns (uint256[] memory) {
        return map(self, FixedPoint.div, dividend);
    }

    function sum(uint256[] memory self) internal pure returns (uint256 total) {
        total = 0;
        for (uint256 i = 0; i < self.length; i++) {
            total = total.add(self[i]);
        }
    }

    function map(
        uint256[] memory self,
        function(uint256, uint256) pure returns (uint256) fn,
        uint256 param
    ) internal pure returns (uint256[] memory results) {
        results = new uint256[](self.length);
        for (uint256 i = 0; i < results.length; i++) {
            results[i] = fn(self[i], param);
        }
    }

    function map(
        uint256[] memory self,
        function(uint256, uint256) pure returns (uint256) fn,
        uint256[] memory params
    ) internal pure returns (uint256[] memory results) {
        results = new uint256[](self.length);
        for (uint256 i = 0; i < results.length; i++) {
            results[i] = fn(self[i], params[i]);
        }
    }

    function map(IERC20[] memory self, function(IERC20) view returns (uint256) fn)
        internal
        view
        returns (uint256[] memory results)
    {
        results = new uint256[](self.length);
        for (uint256 i = 0; i < results.length; i++) {
            results[i] = fn(self[i]);
        }
    }
}
