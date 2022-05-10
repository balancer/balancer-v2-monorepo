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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/misc/IERC4626.sol";

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

contract MockERC4626Token is TestToken, IERC4626 {
    using FixedPoint for uint256;

    // rate of assets per share scaled to 1e18
    uint256 private _rate = 1e18;
    uint256 private _scaleAssetsToFP;
    uint256 private _scaleSharesToFP;
    uint256 private _totalAssets;
    address private immutable _asset;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address asset
    ) TestToken(name, symbol, decimals) {
        _asset = asset;

        uint256 assetDecimals = TestToken(asset).decimals();
        uint256 assetDecimalsDifference = Math.sub(18, assetDecimals);
        _scaleAssetsToFP = FixedPoint.ONE * 10**assetDecimalsDifference;

        uint256 shareDecimalsDifference = Math.sub(18, uint256(decimals));
        _scaleSharesToFP = FixedPoint.ONE * 10**shareDecimalsDifference;
    }

    function setRate(uint256 newRate) external {
        _rate = newRate;
    }

    function totalAssets() external view override returns (uint256) {
        return _totalAssets;
    }

    function asset() external view override returns (address) {
        return _asset;
    }

    function convertToAssets(uint256 shares) external view override returns (uint256) {
        return _convertToAssets(shares);
    }

    function convertToShares(uint256 assets) external view override returns (uint256) {
        return _convertToShares(assets);
    }

    function deposit(uint256 assets, address receiver) external override returns (uint256) {
        uint256 shares = _convertToShares(assets);
        _mint(receiver, shares);
        _totalAssets = _totalAssets.add(assets);
        return shares;
    }

    function redeem(uint256 shares, address, address owner) external override returns (uint256) {
        uint256 assets = _convertToAssets(shares);
        _burn(owner, shares);
        _totalAssets = _totalAssets.sub(assets);
        return assets;
    }

    function _convertToAssets(uint256 shares) private view returns (uint256) {
        uint256 assetsInShareDecimals = shares.mulDown(_rate);
        uint256 assets = assetsInShareDecimals.mulDown(_scaleSharesToFP).divDown(_scaleAssetsToFP);
        return assets;
    }

    function _convertToShares(uint256 assets) private view returns (uint256) {
        uint256 sharesInAssetDecimals = assets.divDown(_rate);
        uint256 shares = sharesInAssetDecimals.mulDown(_scaleAssetsToFP).divDown(_scaleSharesToFP);
        return shares;
    }
}
