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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/ISilo.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "./MockShareToken.sol";

contract MockBaseSilo is IBaseSilo {
    address private immutable _siloAsset;
    mapping(address => AssetStorage) internal _assetStorage;

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
    using FixedPoint for uint256;

    uint256 public rate;

    constructor(address _siloAsset) MockBaseSilo(_siloAsset) {
        rate = FixedPoint.TWO;
    }

    function depositFor(
        address _asset,
        address _depositor,
        uint256 _amount,
        bool /*_collateralOnly*/
    ) external override returns (uint256 collateralAmount, uint256 collateralShare) {
        IERC20(_asset).safeTransferFrom(msg.sender, address(this), _amount);
        address shareTokenAddress = address(_assetStorage[_asset].collateralToken);
        uint256 shares = underlyingToShares(_amount);
        MockShareToken(shareTokenAddress).mint(_depositor, shares);
        return (_amount, shares);
    }

    function withdraw(
        address _asset,
        uint256 _amount,
        bool /*_collateralOnly*/
    ) external override returns (uint256 withdrawnAmount, uint256 withdrawnShare) {
        address shareTokenAddress = address(_assetStorage[_asset].collateralToken);
        uint256 burnedShare;
        // If _amount is set to the max value of a uint256 the whole deposited balance of a user is withdrawn
        if (_amount == type(uint256).max) {
            burnedShare = IShareToken(shareTokenAddress).balanceOf(msg.sender);
            _amount = sharesToUnderlying(burnedShare);
        } else {
            burnedShare = underlyingToShares(_amount);
        }
        MockShareToken(shareTokenAddress).burnWithoutAllowance(msg.sender, burnedShare);
        IERC20(_asset).safeTransfer(msg.sender, _amount);
        return (_amount, burnedShare);
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function sharesToUnderlying(uint256 _amount) public view returns (uint256) {
        return _amount.mulDown(rate);
    }

    function underlyingToShares(uint256 _amount) public view returns (uint256) {
        return _amount.divDown(rate);
    }
}
