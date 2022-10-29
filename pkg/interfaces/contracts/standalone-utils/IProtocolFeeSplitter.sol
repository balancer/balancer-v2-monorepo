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

import "../vault/IVault.sol";
import "./IProtocolFeesWithdrawer.sol";

/**
 * @title ProtocolFeeSplitter
 * @author Daoism Systems
 * @notice Distributes collected protocol fees between Balancer's treasury and a pool owner
 * @dev If you are the pool owner, make sure to update pool's beneficiary address
 * otherwise all BPT tokens go to Balancer's DAO treasury
 */
interface IProtocolFeeSplitter {
    event FeesCollected(
        bytes32 indexed poolId,
        address indexed beneficiary,
        uint256 poolEarned,
        address indexed treasury,
        uint256 treasuryEarned
    );

    event PoolRevenueShareChanged(bytes32 indexed poolId, uint256 revenueSharePercentage);
    event PoolBeneficiaryChanged(bytes32 indexed poolId, address newBeneficiary);
    event DefaultRevenueSharingFeePercentageChanged(uint256 revenueSharePercentage);
    event TreasuryChanged(address newTreasury);

    /**
     * @notice Allows a authorized user to change revenueShare for a `poolId`
     * @param poolId - the poolId of the pool where we want to change fee percentage
     * @param newSwapFeePercentage - new swap fee percentage
     */
    function setRevenueSharingFeePercentage(bytes32 poolId, uint256 newSwapFeePercentage) external;

    /**
     * @notice Allows a pool owner to change the pool beneficiary settings
     * @param poolId - the poolId of the pool where we want to change fee beneficiary
     * @param newBeneficiary - beneficiary address
     */
    function setPoolBeneficiary(bytes32 poolId, address newBeneficiary) external;

    /**
     * @notice Allows a authorized user to change the treasury address
     * @param newTreasury - beneficiary address
     */
    function setTreasury(address newTreasury) external;

    /**
     * @notice Allows a authorized user to change the default revenue sharing fee percentage
     * @param feePercentage - new default revenue sharing fee percentage
     */
    function setDefaultRevenueSharingFeePercentage(uint256 feePercentage) external;

    /**
     * @notice Collects and distributes fees for a `poolId`
     * @param poolId - the poolId of the pool for which we collect fees
     * @return beneficiaryAmount The amount of tokens sent to pool's beneficiary
     * @return treasuryAmount The amount of tokens sent to Balancer's treasury
     */
    function collectFees(bytes32 poolId) external returns (uint256 beneficiaryAmount, uint256 treasuryAmount);

    /**
     * @notice Returns default revenue sharing fee percentage
     */
    function getDefaultRevenueSharingFeePercentage() external view returns (uint256);

    /**
     * @notice Returns amounts that can be colected
     * @param poolId - the poolId of the pool for which we collect fees
     * @return beneficiaryAmount The amount of tokens sent to pool's beneficiary
     * @return treasuryAmount The amount of tokens sent to Balancer's treasury
     */
    function getAmounts(bytes32 poolId) external view returns (uint256 beneficiaryAmount, uint256 treasuryAmount);

    /**
     * @notice Returns Balancer's treasury address.
     */
    function getTreasury() external view returns (address);

    /**
     * @notice Returns the Protocol Fees Withdrawer address.
     */
    function getProtocolFeesWithdrawer() external view returns (IProtocolFeesWithdrawer);

    /**
     * @notice Returns Balancer's vault address.
     */
    function getVault() external view returns (IVault);

    /**
     * @notice Returns a Pool's settings.
     */
    function getPoolSettings(bytes32 poolId)
        external
        view
        returns (uint256 revenueSharePercentageOverride, address beneficiary);
}
