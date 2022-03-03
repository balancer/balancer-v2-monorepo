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
import "@balancer-labs/v2-solidity-utils/contracts/misc/IERC4626.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";

import "./TestToken.sol";
import "../interfaces/IStaticUsdPlusToken.sol";

contract MockStaticUsdPlusToken is TestToken, IERC4626, IStaticUsdPlusToken {
    using FixedPoint for uint256;

    // rate between wrapped and main tokens for deposit/redeem
    uint256 private _rate = 1e18;
    uint256 private _rateScale = 1e18;
    uint256 private _totalAssets;
    address private immutable _depositAsset;
    address private immutable _usdPlusToken;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address depositAsset,
        address usdPlusToken
    ) TestToken(name, symbol, decimals) {
        _depositAsset = depositAsset;
        _usdPlusToken = usdPlusToken;
    }

    // rate at e18 scale
    function setRate(uint256 newRate) external {
        _rate = newRate;
    }

    function totalAssets() external view override returns (uint256){
        return _totalAssets;
    }

    function asset() external view override returns (address){
        return _depositAsset;
    }

    function deposit(uint256 assets, address receiver) external override returns (uint256) {
        uint256 shares = assets.mulDown(_rateScale).divDown(_rate);
        // need update to work with totalSupply
        _mint(receiver, shares);
        _totalAssets = _totalAssets.add(assets);
        return shares;
    }

    function redeem(uint256 shares, address, address owner) external override returns (uint256) {
        uint256 assets = shares.mulDown(_rate).divDown(_rateScale);
        // need update to work with totalSupply
        _burn(owner, shares);
        _totalAssets = _totalAssets.sub(assets);
        return assets;
    }

    /**
     * @dev Wrap UsdPlusToken. Caller should approve `amount` for transferFrom
     * @param recipient The address that will receive StaticUsdPlusTokens
     * @param amount The amount of UsdPlusTokens to wrap
     * @return uint256 The amount of StaticUsdPlusTokens minted to recipient, static balance
     **/
    function wrap(address recipient, uint256 amount) external override returns (uint256){
        ERC20(_usdPlusToken).transferFrom(msg.sender, address(this), amount);
        uint256 mintAmount = amount.mulDown(_rateScale).divDown(_rate);
        _mint(recipient, mintAmount);
        return mintAmount;
    }

    /**
     * @dev Unwrap StaticUsdPlusToken. Caller should approve `amount` for transferFrom
     * @param recipient The address that will receive unwrapped UsdPlusTokens
     * @param amount The amount of UsdTokens to wrap
     * @return uint256 The amount of StaticUsdPlusTokens burned, static balance
     * @return uint256 The amount of UsdPlusTokens sent to recipient, dynamic balance
     **/
    function unwrap(address recipient, uint256 amount) external override returns (uint256, uint256){
        _burn(msg.sender, amount);
        uint256 transferAmount = amount.mulDown(_rate).divDown(_rateScale);
        ERC20(_usdPlusToken).transfer(recipient, transferAmount);
        return (amount, transferAmount);
    }


    function mainToken() external view override returns (address){
        return _usdPlusToken;
    }
}
