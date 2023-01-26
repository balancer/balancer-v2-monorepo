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

interface IInterestRateModel {
    /// @dev get compound interest rate
    /// @param silo address of Silo
    /// @param asset address of an asset in Silo for which interest rate should be calculated
    /// @param blockTimestamp current block timestamp
    /// @return rcomp compounded interest rate from last update until now (1e18 == 100%)
    function getCompoundInterestRate(
        address silo,
        address asset,
        uint256 blockTimestamp
    ) external view returns (uint256 rcomp);

    /// @dev get current annual interest rate
    /// @param _silo address of Silo
    /// @param _asset address of an asset in Silo for which interest rate should be calculated
    /// @param _blockTimestamp current block timestamp
    /// @return rcur current annual interest rate (1e18 == 100%)
    function getCurrentInterestRate(
        address _silo,
        address _asset,
        uint256 _blockTimestamp
    ) external view returns (uint256 rcur);
}

interface ISiloRepository {
    /// @notice Get Interest Rate Model address for asset in given Silo
    /// @dev If dedicated config is not set, method returns default config
    /// @param silo address of Silo
    /// @param asset address of an asset
    /// @return address of interest rate model
    function getInterestRateModel(address silo, address asset) external view returns (IInterestRateModel);

    /// @dev Get protocol share fee
    /// @return protocol share fee in precision points (Solvency._PRECISION_DECIMALS == 100%)
    function protocolShareFee() external view returns (uint256);
}

interface IBaseSilo {
    enum AssetStatus {
        Undefined,
        Active,
        Removed
    }

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
        // COLLATERAL ONLY: Amount of asset token that has been deposited to Silo that can be ONLY used
        // as collateral. These deposits do NOT earn interest and CANNOT be borrowed.
        uint256 collateralOnlyDeposits;
        // DEBT: Amount of asset token that has been borrowed with accrued interest.
        uint256 totalBorrowAmount;
    }

    /// @dev Storage struct that holds data related to fees and interest
    struct AssetInterestData {
        // Total amount of already harvested protocol fees
        uint256 harvestedProtocolFees;
        // Total amount (ever growing) of asset token that has been earned by the protocol from
        // generated interest.
        uint256 protocolFees;
        // Timestamp of the last time `interestRate` has been updated in storage.
        uint64 interestRateTimestamp;
        // True if asset was removed from the protocol. If so, deposit and borrow functions are disabled
        // for that asset
        AssetStatus status;
    }

    /**
     * @dev returns the asset storage struct
     * @dev AssetStorage struct contains necessary information for calculating shareToken exchange rates
     */
    function assetStorage(address _asset) external view returns (AssetStorage memory);

    /**
     * @dev returns the interest data struct
     * @dev Interest data struct helps us update necessary asset storage data closer to the time that it is
     * updated on Silo's protocol during deposits and withdraws
     */
    function interestData(address _asset) external view returns (AssetInterestData memory);

    /// @notice Get Silo Repository contract address
    /// @return Silo Repository contract address
    function siloRepository() external view returns (ISiloRepository);
}

interface ISilo is IBaseSilo {
    /**
     * @dev Deposits funds into the Silo
     * @param _asset The address of the token to deposit
     * @param _amount The amount of the token to deposit
     * @param _collateralOnly: True means your shareToken is protected (cannot be swapped for interest)
     * @return collateralAmount deposited amount
     * @return collateralShare user collateral shares based on deposited amount
     */
    function deposit(
        address _asset,
        uint256 _amount,
        bool _collateralOnly
    ) external returns (uint256 collateralAmount, uint256 collateralShare);

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
     * @dev Withdraws funds from the Silo
     * @param _asset The address of the token to withdraw
     * @param _amount The amount of the token to withdraw
     * @param _collateralOnly: True means your shareToken is protected (cannot be swapped for interest)
     * @return withdrawnAmount withdrawn amount that was transferred to user
     * @return withdrawnShare burned share based on `withdrawnAmount`
     */
    function withdraw(
        address _asset,
        uint256 _amount,
        bool _collateralOnly
    ) external returns (uint256 withdrawnAmount, uint256 withdrawnShare);

    /**
     * @dev Withdraws funds from the Silo
     * @param _asset The address of the token to withdraw
     * @param _depositor The address that originally deposited the collateral tokens being withdrawn,
     * it should be the one initiating the withdrawal through the router
     * @param _receiver The address that will receive the withdrawn tokens
     * @param _amount The amount of the token to withdraw
     * @param _collateralOnly: True means your shareToken is protected (cannot be swapped for interest)
     * @return withdrawnAmount withdrawn amount that was transferred to user
     * @return withdrawnShare burned share based on `withdrawnAmount`
     */
    function withdrawFor(
        address _asset,
        address _depositor,
        address _receiver,
        uint256 _amount,
        bool _collateralOnly
    ) external returns (uint256 withdrawnAmount, uint256 withdrawnShare);
}
