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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";

import "../../aave/DataTypes.sol";

// solhint-disable no-unused-vars
contract MockAToken is ERC20 {
    address public owner;

    constructor(
        address admin,
        string memory name,
        string memory symbol,
        uint8 /*decimals */
    ) ERC20(name, symbol) {
        owner = admin;
    }

    function mint(address recipient, uint256 amount) external {
        require(msg.sender == owner, "only owner can mint");
        _mint(recipient, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == owner, "only owner can burn");
        _burn(from, amount);
    }
}

// contract MockAaveLendingPool is ILendingPool {
contract MockAaveLendingPool {
    uint256 public liquidityIndex = 1e27;
    mapping(address => address) public aTokens;

    // convenience method
    function registerAToken(address asset, address aToken) external {
        aTokens[asset] = aToken;
    }

    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /*referralCode*/
    ) external {
        MockAToken t = MockAToken(aTokens[asset]);
        t.mint(address(onBehalfOf), amount);
        IERC20(asset).transferFrom(onBehalfOf, address(this), amount);
    }

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        MockAToken t = MockAToken(aTokens[asset]);
        t.burn(to, amount);
        IERC20(asset).transfer(to, amount);
        return amount;
    }

    function getReserveData(
        address /*asset*/
    ) external view returns (DataTypes.ReserveData memory) {
        return
            DataTypes.ReserveData({
                configuration: DataTypes.ReserveConfigurationMap({ data: 0 }),
                liquidityIndex: 0,
                variableBorrowIndex: 0,
                currentLiquidityRate: 0,
                currentVariableBorrowRate: 0,
                currentStableBorrowRate: 0,
                lastUpdateTimestamp: 0,
                aTokenAddress: address(this),
                stableDebtTokenAddress: address(0),
                variableDebtTokenAddress: address(0),
                interestRateStrategyAddress: address(0),
                id: 0
            });
    }

    function simulateATokenIncrease(
        address asset,
        uint256 amount,
        address to
    ) public {
        MockAToken t = MockAToken(aTokens[asset]);
        t.mint(to, amount);
    }
}
