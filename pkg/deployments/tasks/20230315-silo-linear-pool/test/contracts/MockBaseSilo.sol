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

import "@balancer-labs/v2-pool-utils/contracts/test/MaliciousQueryReverter.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";

import "../interfaces/IShareToken.sol";
import "../interfaces/ISiloRepository.sol";
import "../interfaces/ISilo.sol";

contract MockBaseSilo is IBaseSilo, MaliciousQueryReverter {
    // asset address for which Silo was created
    address private immutable _siloAsset;

    ISiloRepository private immutable _siloRepository;

    /// @dev asset => AssetStorage
    mapping(address => AssetStorage) private _assetStorage;

    /// @dev asset => AssetInterestData
    mapping(address => AssetInterestData) private _interestData;

    constructor(ISiloRepository siloRepository, address siloAsset) {
        _siloRepository = siloRepository;
        _siloAsset = siloAsset;
    }

    function assetStorage(address _asset) external view override returns (AssetStorage memory) {
        maybeRevertMaliciously();
        AssetStorage memory assetMapping = _assetStorage[_asset];
        return assetMapping;
    }

    function interestData(address _asset) external view override returns (AssetInterestData memory) {
        maybeRevertMaliciously();
        return _interestData[_asset];
    }

    function siloAsset() external view returns (address) {
        maybeRevertMaliciously();
        return _siloAsset;
    }

    function siloRepository() external view override returns (ISiloRepository) {
        maybeRevertMaliciously();
        return _siloRepository;
    }

    function setAssetStorage(
        address interestBearingAsset,
        IShareToken collateralToken,
        IShareToken collateralOnlyToken,
        IShareToken debtToken,
        uint256 totalDeposits,
        uint256 collateralOnlyDeposits,
        uint256 totalBorrowAmount
    ) external {
        maybeRevertMaliciously();
        AssetStorage memory storageValue = AssetStorage(
            collateralToken,
            collateralOnlyToken,
            debtToken,
            totalDeposits,
            collateralOnlyDeposits,
            totalBorrowAmount
        );

        _assetStorage[interestBearingAsset] = storageValue;
    }

    function setInterestData(
        address interestBearingAsset,
        uint256 harvestedProtocolFees,
        uint256 protocolFees,
        uint64 interestRateTimestamp,
        AssetStatus status
    ) external {
        maybeRevertMaliciously();
        AssetInterestData memory interestValue = AssetInterestData(
            harvestedProtocolFees,
            protocolFees,
            interestRateTimestamp,
            status
        );

        _interestData[interestBearingAsset] = interestValue;
    }
}
