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
import "@balancer-labs/v2-interfaces/contracts/pool-linear/IShareToken.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";
import "../silo/SiloHelpers.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-linear/ISilo.sol";
import "hardhat/console.sol";

contract MockBaseSilo is IBaseSilo {
    // asset address for which Silo was created
    address public immutable _siloAsset;

    /// @dev asset => AssetStorage
    mapping(address => AssetStorage) private _assetStorage;

    constructor(address siloAsset) {
        _siloAsset = siloAsset;
    }

    function assetStorage(address _asset) external view override returns (AssetStorage memory) {
        AssetStorage memory assetMapping = _assetStorage[_asset];
        return assetMapping;
    }

    function siloAsset() external view returns (address) {
        return _siloAsset;
    }

    function setAssetStorage(
        address interestBarringAsset,
        IShareToken collateralToken,
        IShareToken collateralOnlyToken,
        IShareToken debtToken,
        uint256 totalDeposits,
        uint256 collateralOnlyDeposits,
        uint256 totalBorrowAmount
    ) external {
        AssetStorage memory storageValue = AssetStorage(
            collateralToken,
            collateralOnlyToken,
            debtToken,
            totalDeposits,
            collateralOnlyDeposits,
            totalBorrowAmount
        );

        _assetStorage[interestBarringAsset] = storageValue;
    }
}
