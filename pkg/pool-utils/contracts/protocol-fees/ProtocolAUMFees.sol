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
pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import "./ProtocolFees.sol";

library ProtocolAUMFees {
    /**
     * @notice Calculates the amount of BPT to mint to pay AUM fees accrued since the last collection.
     * @dev This calculation assumes that the Pool's total supply is constant over the fee period.
     *
     * When paying AUM fees over short durations, significant rounding errors can be introduced when converting from a
     * percentage of the pool to a BPT amount. To combat this, we convert the yearly percentage to BPT and then scale
     * appropriately.
     */
    function getAumFeesBptAmount(
        uint256 totalSupply,
        uint256 currentTime,
        uint256 lastCollection,
        uint256 annualAumFeePercentage
    ) internal pure returns (uint256) {
        // If no time has passed since the last collection then clearly no fees are accrued so we can return early.
        // We also perform an early return if the AUM fee is zero.
        if (currentTime <= lastCollection || annualAumFeePercentage == 0) return 0;

        uint256 annualBptAmount = ProtocolFees.bptForPoolOwnershipPercentage(totalSupply, annualAumFeePercentage);

        // We want to collect fees so that after a year the Pool will have paid `annualAumFeePercentage` of its AUM as
        // fees. In normal operation however, we will collect fees regularly over the course of the year so we
        // multiply `annualBptAmount` by the fraction of the year which has elapsed since we last collected fees.
        uint256 elapsedTime = currentTime - lastCollection;

        // Like with all other fees, we round down, favoring LPs.
        return Math.divDown(Math.mul(annualBptAmount, elapsedTime), 365 days);
    }
}
