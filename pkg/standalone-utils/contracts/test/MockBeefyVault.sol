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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/IBeefyVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

contract MockBeefyVault is IBeefyVault, TestToken {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    IERC20 public underlyingAsset;
    uint256 underlyingDecimals;
    uint256 private _balance = 0;
    uint256 _desiredRate;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address _underlyingAsset
    ) TestToken(name, symbol, decimals) {
        underlyingAsset = IERC20(_underlyingAsset);
        underlyingDecimals = decimals;
    }

    function getPricePerFullShare() external view override returns (uint256) {
        uint256 wrappedTotalSupply = IERC20(address(this)).totalSupply();
        return wrappedTotalSupply.divDown(_balance);
    }

    function balance() external view override returns (uint256) {
        return _balance;
    }

    // Should pass rate with decimals from underlyingToken
    function setRate(uint256 newRate) public {
        _desiredRate = newRate;
        uint256 totalSupply = this.totalSupply();
        _balance = totalSupply.divDown(newRate);
    }

    function deposit(uint256 amount) external override {
        IERC20(underlyingAsset).safeTransferFrom(msg.sender, address(this), amount);
        uint256 wrappedAmount = this.toBeefyAmount(amount);
        this.mint(msg.sender, wrappedAmount);
        // Since rate calculation depends on totalSupply, we need to recalculate parameters
        // that are base to rate calculation.
        setRate(_desiredRate);
    }

    function withdraw(uint256 numberOfShares) external override {
        this.burn(msg.sender, numberOfShares);
        // Since rate calculation depends on totalSupply, we need to recalculate parameters
        // that are base to rate calculation.
        setRate(_desiredRate);
        uint256 mainAmount = this.fromBeefyAmount(numberOfShares);
        TestToken(address(underlyingAsset)).mint(msg.sender, mainAmount);
    }

    function want() external view override returns (address) {
        return address(underlyingAsset);
    }

    // Exposing these functions to make it easy to calculate rate on tests. Can't be used in production
    function fromBeefyAmount(uint256 wrappedAmount) external view returns (uint256) {
        uint256 rate = this.getPricePerFullShare();
        return wrappedAmount.divDown(rate);
    }

    // Exposing these functions to make it easy to calculate rate on tests. Can't be used in production
    function toBeefyAmount(uint256 mainAmount) external view returns (uint256) {
        uint256 rate = this.getPricePerFullShare();
        return rate.mulDown(mainAmount);
    }
}
