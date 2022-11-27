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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/ITetuSmartVault.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";


contract MockTetuSmartVault is ITetuSmartVault, TestToken {
    using SafeERC20 for IERC20;

    IERC20 public underlyingAsset;
    uint256 underlyingDecimals;
    uint256 private _pricePerFullShare;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address _underlyingAsset,
        uint256 fullSharePrice
    )TestToken(name, symbol, decimals)  {
        underlyingAsset = IERC20(_underlyingAsset);
        underlyingDecimals = decimals;
        _pricePerFullShare = fullSharePrice;
    }

    function getPricePerFullShare() external view override returns (uint256) {
        return _pricePerFullShare;
    }

    function setPricePerFullShare(uint256 _newPricePerFullShare) public {
        _pricePerFullShare = _newPricePerFullShare;
    }

    function underlyingBalanceInVault() external override view returns (uint256){
        return underlyingAsset.balanceOf(address(this));
    }

    function underlyingBalanceWithInvestmentForHolder(address) external override view returns (uint256){
        return underlyingAsset.balanceOf(address(this));
    }

    function deposit(uint256 amount) external override {
        underlyingAsset.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
    }

    function withdraw(uint256 numberOfShares) external override {
        underlyingAsset.transfer(msg.sender, numberOfShares);
    }

    function transferUnderlying(uint amount, address to) public {
        underlyingAsset.transfer(to, amount);
    }

    function underlying() external override view returns (address){
        return address(underlyingAsset);
    }

    function underlyingUnit() external override view returns (uint256){
        return 10 ** underlyingDecimals;
    }

}
