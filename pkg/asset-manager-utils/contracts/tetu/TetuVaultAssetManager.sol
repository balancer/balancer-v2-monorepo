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

import "./TetuRewardsAssetManager.sol";
import "../test/tetu/ISmartVault.sol";

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;


/**
 * @title TetuVaultAssetManager
 * @dev TetuVaultAssetManager is a simple implementation to demonstrate the concept. Need to be improve at production
 */

contract TetuVaultAssetManager is TetuRewardsAssetManager {

    address public underlying;
    address public tetuVault;

    constructor(
        IVault balancerVault,
        address _tetuVault,
        address _underlying
    ) TetuRewardsAssetManager(balancerVault, bytes32(0), IERC20(_underlying)) {
        require(_underlying != address(0), "zero underlying");
        underlying = _underlying;
        tetuVault = _tetuVault;
    }

    /**
     * @dev Should be called in same transaction as deployment through a factory contract
     * @param poolId - the id of the pool
     */
    function initialize(bytes32 poolId) public {
        _initialize(poolId);
    }

    /**
     * @dev Deposits capital into Iron
     * @param amount - the amount of tokens being deposited
     * @return the amount deposited
     */
    function _invest(uint256 amount, uint256) internal override returns (uint256) {
        uint256 balance = IERC20(underlying).balanceOf(address(this));

        if (amount > balance) {
            amount = balance;
        }
        IERC20(underlying).approve(tetuVault, 0);
        IERC20(underlying).approve(tetuVault, amount);


        ISmartVault(tetuVault).deposit(balance);
        return amount;
    }

    /**
     * @dev Withdraws capital out of TetuVault
     * @param amountUnderlying - the amount to withdraw
     * @return the number of tokens to return to the tetuVault
     */
    function _divest(uint256 amountUnderlying, uint256) internal override returns (uint256) {
        amountUnderlying = Math.min(amountUnderlying, _getAUM());
        uint balBefore = IERC20(underlying).balanceOf(address(this));
        if (amountUnderlying > 0) {
            ISmartVault(tetuVault).withdraw(amountUnderlying);
        }
        uint divested = IERC20(underlying).balanceOf(address(this));
        return divested;
    }

    /**
     * @dev Checks balance of managed assets
     */
    function _getAUM() internal view override returns (uint256) {
        return ISmartVault(tetuVault).underlyingBalanceWithInvestmentForHolder(address(this));
    }
}
