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
import "./ExternalFees.sol";

library InvariantGrowthProtocolSwapFees {
    using FixedPoint for uint256;

    function getProtocolOwnershipPercentage(
        uint256 invariantGrowthRatio,
        uint256 supplyGrowthRatio,
        uint256 protocolSwapFeePercentage
    ) internal pure returns (uint256) {
        // Joins and exits are symmetrical; for simplicity, we consider a join, where the invariant and supply
        // both increase.

        // |-------------------------|-- original invariant * invariantGrowthRatio
        // |   increase from fees    |
        // |-------------------------|-- original invariant * supply growth ratio (fee-less invariant)
        // |                         |
        // | increase from balances  |
        // |-------------------------|-- original invariant
        // |                         |
        // |                         |  |------------------|-- currentSupply
        // |                         |  |    BPT minted    |
        // |                         |  |------------------|-- previousSupply
        // |   original invariant    |  |  original supply |
        // |_________________________|  |__________________|
        //
        // If the join is proportional, the invariant and supply will likewise increase proportionally,
        // so the growth ratios (invariantGrowthRatio / supplyGrowthRatio) will be equal. In this case, we do not charge
        // any protocol fees.
        // We also charge no protocol fees in the case where `invariantGrowthRatio < supplyGrowthRatio` to avoid
        // potential underflows, however this should only occur in extremely low volume actions due solely to rounding
        // error.

        if ((supplyGrowthRatio >= invariantGrowthRatio) || (protocolSwapFeePercentage == 0)) return 0;

        // If the join is non-proportional, the supply increase will be proportionally less than the invariant increase,
        // since the BPT minted will be based on fewer tokens (because swap fees are not included). So the supply growth
        // is due entirely to the balance changes, while the invariant growth also includes swap fees.
        //
        // To isolate the amount of increase by fees then, we multiply the original invariant by the supply growth
        // ratio to get the "feeless invariant". The difference between the final invariant and this value is then
        // the amount of the invariant due to fees, which we convert to a percentage by normalizing against the
        // final invariant. This is expressed as the expression below:
        //
        // invariantGrowthFromFees = currentInvariant - supplyGrowthRatio * previousInvariant
        //
        // We then divide through by current invariant so the LHS can be identified as the fraction of the pool which
        // is made up of accumulated swap fees.
        //
        // swapFeesPercentage = 1 - supplyGrowthRatio * previousInvariant / currentInvariant
        //
        // We then define `invariantGrowthRatio` in a similar fashion to `supplyGrowthRatio` to give the result:
        //
        // swapFeesPercentage = 1 - supplyGrowthRatio / invariantGrowthRatio
        //
        // Using this form allows us to consider only the ratios of the two invariants, rather than their absolute
        // values: a useful property, as this is sometimes easier than calculating the full invariant twice.

        // We've already checked that `supplyGrowthRatio` is smaller than `invariantGrowthRatio`, and hence their ratio
        // smaller than FixedPoint.ONE, allowing for unchecked arithmetic.
        uint256 swapFeesPercentage = FixedPoint.ONE - supplyGrowthRatio.divDown(invariantGrowthRatio);

        // We then multiply by the protocol swap fee percentage to get the fraction of the pool which the protocol
        // should own once fees have been collected.
        return swapFeesPercentage.mulDown(protocolSwapFeePercentage);
    }

    function calcDueProtocolFees(
        uint256 invariantGrowthRatio,
        uint256 previousSupply,
        uint256 currentSupply,
        uint256 protocolSwapFeePercentage
    ) internal pure returns (uint256) {
        uint256 protocolOwnershipPercentage = getProtocolOwnershipPercentage(
            invariantGrowthRatio,
            currentSupply.divDown(previousSupply),
            protocolSwapFeePercentage
        );

        return ExternalFees.bptForPoolOwnershipPercentage(currentSupply, protocolOwnershipPercentage);
    }
}
