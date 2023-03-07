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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/ITetuSmartVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "./MockTetuStrategy.sol";
import "./MockTetuShareValueHelper.sol";

contract MockTetuSmartVault is ITetuSmartVault, TestToken, MockTetuShareValueHelper {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    IERC20 public immutable underlyingAsset;
    uint256 private immutable _underlyingDecimals;
    uint256 private _underlyingBalanceInVault = 0;
    MockTetuStrategy private immutable _tetuStrategy;
    uint256 private _desiredRate;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address _underlyingAsset,
        MockTetuStrategy tetuStrategy
    ) TestToken(name, symbol, decimals) {
        underlyingAsset = IERC20(_underlyingAsset);
        _underlyingDecimals = decimals;
        _tetuStrategy = tetuStrategy;
    }

    function getPricePerFullShare() external pure override returns (uint256) {
        revert("Should not call this");
    }

    // Should pass rate with decimals from underlyingToken
    function setRate(uint256 newRate) public {
        // stores latest rate, so the balances are recalculated after deposit and withdraw
        _desiredRate = newRate;
        _setRate(newRate);
    }

    function underlyingBalanceInVault() external view override returns (uint256) {
        return _underlyingBalanceInVault;
    }

    function underlyingBalanceWithInvestmentForHolder(address) external view override returns (uint256) {
        return underlyingAsset.balanceOf(address(this));
    }

    function deposit(uint256 amount) external override {
        underlyingAsset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 wrappedAmount = _toTetuAmount(amount, this);
        _mint(msg.sender, wrappedAmount);
    }

    function depositFor(uint256 , address) external pure override {
        _revert(Errors.SHOULD_NOT_HAPPEN);
    }

    function withdraw(uint256 numberOfShares) external override {
        _burn(msg.sender, numberOfShares);
        uint256 mainAmount = _fromTetuAmount(numberOfShares, this);
        underlyingAsset.safeTransfer(msg.sender, mainAmount);
    }

    function transferUnderlying(uint256 amount, address to) public {}

    function underlying() external view override returns (address) {
        return address(underlyingAsset);
    }

    function underlyingUnit() external view override returns (uint256) {
        return 10**_underlyingDecimals;
    }

    function strategy() external view override returns (address) {
        return address(_tetuStrategy);
    }

    function _burn(address account, uint256 amount) internal virtual override {
        super._burn(account, amount);
        // Since rate calculation depends on totalSupply, we need to recalculate parameters
        // that are base to rate calculation.
        _setRate(_desiredRate);
    }

    function _mint(address account, uint256 amount) internal virtual override {
        super._mint(account, amount);
        // Since rate calculation depends on totalSupply, we need to recalculate parameters
        // that are base to rate calculation.
        _setRate(_desiredRate);
    }

    function _setRate(uint256 newRate) private {
        uint256 totalSupply = this.totalSupply();
        // arbitrary number, just to make sure that both Vault and Invested values compose the rate.
        uint8 vaultInvestedRatio = 3;
        uint256 totalBalance = (newRate * totalSupply) / 10**_underlyingDecimals;
        _underlyingBalanceInVault = totalBalance / vaultInvestedRatio;
        _tetuStrategy.setInvestedUnderlyingBalance(totalBalance - _underlyingBalanceInVault);
    }
}
