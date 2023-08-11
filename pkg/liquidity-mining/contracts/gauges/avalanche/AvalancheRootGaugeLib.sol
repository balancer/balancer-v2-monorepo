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

library AvalancheRootGaugeLib {
    /// @dev Truncates given amount to the maximum allowed precision.
    function removeDust(uint256 amount, uint256 dustModulo) internal pure returns (uint256) {
        uint256 dust = amount % dustModulo;
        return amount - dust;
    }

    /// @dev Returns given address as bytes32, padded with zeroes to the left.
    function bytes32Recipient(address recipient) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(recipient)));
    }
}
