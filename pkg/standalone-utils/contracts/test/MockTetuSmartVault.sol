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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/test/TestToken.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "./MockTetuStrategy.sol";

contract MockTetuSmartVault is ITetuSmartVault, TestToken {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    IERC20 public underlyingAsset;
    uint256 underlyingDecimals;
    uint256 private _underlyingBalanceInVault = 0;
    MockTetuStrategy private immutable _tetuStrategy;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address _underlyingAsset,
        MockTetuStrategy tetuStrategy
    ) TestToken(name, symbol, decimals) {
        underlyingAsset = IERC20(_underlyingAsset);
        underlyingDecimals = decimals;
        _tetuStrategy = tetuStrategy;
    }

    function getPricePerFullShare() external pure override returns (uint256) {
        revert("Should not call this");
    }

    // Should pass rate with decimals from underlyingToken
    function setRate(uint256 newRate) public {
        uint256 totalSupply = this.totalSupply();
        // arbitrary number, just to make sure that both Vault and Invested values compose the rate.
        uint8 vaultInvestedRatio = 3;
        _underlyingBalanceInVault = newRate * totalSupply / (vaultInvestedRatio * 10**underlyingDecimals);
        _tetuStrategy.setInvestedUnderlyingBalance(
            (vaultInvestedRatio - 1) * newRate * totalSupply / (vaultInvestedRatio * 10**underlyingDecimals)
        );
    }

    function underlyingBalanceInVault() external view override returns (uint256) {
        return _underlyingBalanceInVault;
    }

    function underlyingBalanceWithInvestmentForHolder(address) external view override returns (uint256) {
        return underlyingAsset.balanceOf(address(this));
    }

    function deposit(uint256 amount) external override {}

    function depositFor(uint256 amount, address recipient) external override {
        IERC20(underlyingAsset).safeTransferFrom(msg.sender, address(this), amount);
        uint256 wrappedAmount = _getWrappedAmount(amount, this);
        this.mint(recipient, wrappedAmount);
    }

    function withdraw(uint256 numberOfShares) external override {
        this.burn(msg.sender, numberOfShares);
        uint256 mainAmount = _getMainAmount(numberOfShares, this);
        TestToken(address(underlyingAsset)).mint(msg.sender, mainAmount);
    }

    function transferUnderlying(uint256 amount, address to) public {}

    function underlying() external view override returns (address) {
        return address(underlyingAsset);
    }

    function underlyingUnit() external view override returns (uint256) {
        return 10**underlyingDecimals;
    }

    function strategy() external view override returns (address) {
        return address(_tetuStrategy);
    }

    function _getMainAmount(uint256 wrappedAmount, ITetuSmartVault _wrappedToken) private view returns (uint256) {
        uint256 rate = _getWrappedTokenRate(_wrappedToken);
        return wrappedAmount.divDown(rate);
    }

    function _getWrappedAmount(uint256 mainAmount, ITetuSmartVault _wrappedToken) private view returns (uint256) {
        uint256 rate = _getWrappedTokenRate(_wrappedToken);
        return rate.mulDown(mainAmount);
    }

    function _getWrappedTokenRate(ITetuSmartVault _wrappedToken) private view returns (uint256) {
        uint256 wrappedTotalSupply = IERC20(address(_wrappedToken)).totalSupply();
        if (wrappedTotalSupply == 0) {
            return 0;
        }
        // We couldn't use tetuVault.getPricePerFullShare function, since it introduces rounding issues in tokens
        // with a small number of decimals. Therefore, we're calculating the rate using balance and suply
        uint256 underlyingBalance = _wrappedToken.underlyingBalanceInVault();
        address tetuStrategyAddress = ITetuSmartVault(address(_wrappedToken)).strategy();
        if (address(tetuStrategyAddress) == address(0)) {
            return (10**18 * underlyingBalance/ wrappedTotalSupply) + 1;
        }
        uint256 strategyInvestedUnderlyingBalance = ITetuStrategy(tetuStrategyAddress).investedUnderlyingBalance();
        return (10**18 * (underlyingBalance + strategyInvestedUnderlyingBalance) / wrappedTotalSupply) + 1;
    }
}
