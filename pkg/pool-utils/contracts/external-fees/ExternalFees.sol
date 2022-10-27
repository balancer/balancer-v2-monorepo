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

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

library ExternalFees {
    using FixedPoint for uint256;

    /**
     * @dev Calculates the amount of BPT necessary to give ownership of a given percentage of the Pool to an external
     * third party. In the case of protocol fees, this is the DAO, but could also be a pool manager, etc.
     * Note that this function reverts if `poolPercentage` >= 100%, it's expected that the caller will enforce this.
     * @param totalSupply - The total supply of the pool prior to minting BPT.
     * @param poolOwnershipPercentage - The desired ownership percentage of the pool to have as a result of minting BPT.
     * @return bptAmount - The amount of BPT to mint such that it is `poolPercentage` of the resultant total supply.
     */
    function bptForPoolOwnershipPercentage(uint256 totalSupply, uint256 poolOwnershipPercentage)
        internal
        pure
        returns (uint256)
    {
        // If we mint some amount `bptAmount` of BPT then the percentage ownership of the pool this grants is given by:
        // `poolOwnershipPercentage = bptAmount / (totalSupply + bptAmount)`.
        // Solving for `bptAmount`, we arrive at:
        // `bptAmount = totalSupply * poolOwnershipPercentage / (1 - poolOwnershipPercentage)`.
        return Math.divDown(Math.mul(totalSupply, poolOwnershipPercentage), poolOwnershipPercentage.complement());
    }
}
