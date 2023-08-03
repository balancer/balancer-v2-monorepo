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

pragma solidity >=0.7.0 <0.9.0;

import "./ILiquidityGauge.sol";

interface IStakelessGauge is ILiquidityGauge {
    /**
     * @dev Performs a checkpoint, computing how much rewards should be minted for the gauge.
     */
    function checkpoint() external payable returns (bool);

    /**
     * @dev Returns the address that will receive the rewards (either the L2 gauge, or a mainnet address).
     */
    function getRecipient() external view returns (address);
}
