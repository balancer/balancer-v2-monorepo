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

interface IAccSwapFeeStrategy {
    //TODO: add a view to get accSwapFees?

    /**
     * @dev Returns accumulated swap fees since last reset.
     */
    //TODO: anyone can call it, when merging strategies with controllers, this function should be internal
    function getAccSwapFees(uint128[] calldata balances) external returns (uint128[] memory);

    /**
     * @dev Resets swap fees counter.
     */
    //TODO: anyone can call it, when merging strategies with controllers, this function should be internal
    function resetAccSwapFees(uint128[] calldata balances) external;
}
