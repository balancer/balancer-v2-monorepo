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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/ISilo.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "./MockShareToken.sol";

contract MockBaseSilo is IBaseSilo {
    address private immutable _siloAsset;
    mapping(address => AssetStorage) private _assetStorage;

    constructor(address siloAsset) {
        _siloAsset = siloAsset;
    }

    function assetStorage(address _asset) external view override returns (AssetStorage memory) {
        return _assetStorage[_asset];
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
}

contract MockSilo is ISilo, MockBaseSilo {
    using SafeERC20 for IERC20;

    constructor(address _siloAsset) MockBaseSilo(_siloAsset) {
        // No need to set anything for relayer implementation
    }

    function depositFor(
        address _asset,
        address _depositor,
        uint256 _amount,
        bool /*_collateralOnly*/
    ) external override returns (uint256 collateralAmount, uint256 collateralShare) {
        IERC20(_asset).safeTransferFrom(msg.sender, address(this), _amount);
        address shareTokenAddress = address(this.assetStorage(_asset).collateralToken);
        MockShareToken(shareTokenAddress).mint(_depositor, _amount);
        return (_amount, 0);
    }

    function withdrawFor(
        address _asset,
        address _depositor,
        address _receiver,
        uint256 _amount,
        bool /*_collateralOnly*/
    ) external override returns (uint256 withdrawnAmount, uint256 withdrawnShare) {
        address shareTokenAddress = address(this.assetStorage(_asset).collateralToken);
        MockShareToken(shareTokenAddress).burn(_depositor, _amount);
        TestToken(_asset).mint(_receiver, _amount);
        return (_amount, 0);
    }

    function withdraw(address /*_asset*/, uint256 _amount, bool /*_collateralOnly*/)
        external
        override
        pure
        returns (uint256 withdrawnAmount, uint256 withdrawnShare) {
            return (_amount, 0);
        }  
}
