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
pragma experimental ABIEncoderV2;

import "./IShareToken.sol";

interface IBaseSilo {
    /// Storage struct that holds all required data for a single token market
    struct AssetStorage {
        // Token that represents a share in totalDeposits of Silo
        IShareToken collateralToken;
        // Token that represents a share in collateralOnlyDeposits of Silo
        IShareToken collateralOnlyToken;
        // Token that represents a share in totalBorrowAmount of Silo
        IShareToken debtToken;
        // COLLATERAL: Amount of asset token that has been deposited to Silo with interest earned by depositors.
        // It also includes token amount that has been borrowed.
        uint256 totalDeposits;
        // COLLATERAL ONLY: Amount of asset token that has been deposited to Silo that can ONLY be used
        // as collateral. These deposits do NOT earn interest and CANNOT be borrowed.
        uint256 collateralOnlyDeposits;
        // DEBT: Amount of asset token that has been borrowed with accrued interest.
        uint256 totalBorrowAmount;
    }

    /**
     * @dev returns the asset storage struct
     * @dev AssetStorage struct contains necessary information for calculating shareToken exchange rates
     */
    function assetStorage(address _asset) external view returns (AssetStorage memory);
}

interface ISilo is IBaseSilo {
    /**
     * @dev Deposits funds into the Silo
     * @param _asset The address of the token to deposit
     * @param _depositor The address of the recipient of collateral tokens
     * @param _amount The amount of the token to deposit
     * @param _collateralOnly: True means your shareToken is protected (cannot be swapped for interest)
     * @return collateralAmount deposited amount
     * @return collateralShare user collateral shares based on deposited amount
     */
    function depositFor(
        address _asset,
        address _depositor,
        uint256 _amount,
        bool _collateralOnly
    ) external returns (uint256 collateralAmount, uint256 collateralShare);

    /**
     * @dev Withdraw `_amount` of `_asset` tokens from the Silo to `msg.sender`
     * @param _asset The address of the token to withdraw
     * @param _amount The amount of the token to withdraw
     * @param _collateralOnly True if withdrawing collateral only deposit
     * @return withdrawnAmount withdrawn amount that was transferred to user
     * @return withdrawnShare burned share based on `withdrawnAmount`
     */
    function withdraw(
        address _asset,
        uint256 _amount,
        bool _collateralOnly
    ) external returns (uint256 withdrawnAmount, uint256 withdrawnShare);
}
