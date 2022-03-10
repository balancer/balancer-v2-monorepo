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




import "./RewardsAssetManager.sol";

import "./tetu/ISmartVault.sol";

import "hardhat/console.sol";



pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

contract TetuVaultAssetManager is RewardsAssetManager {
//    address public constant VAULT = address(0xeE3B4Ce32A6229ae15903CDa0A5Da92E739685f7);

    address public underlying;
    address public tetuVault;

    constructor(
        IVault balancerVault,
        address _tetuVault,
        address _underlying
    ) RewardsAssetManager(balancerVault, bytes32(0), IERC20(_underlying)) {
        require(_underlying != address(0), "zero underlying");
//        require(_underlying == ISmartVault(_tetuVault).underlying(), "wrong vault underlying");
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
        console.log("invest amount: %s", amount);
        uint256 balance = IERC20(underlying).balanceOf(address(this));
        console.log("invest balance: %s", balance);

        if (amount < balance) {
            balance = amount;
        }
        IERC20(underlying).approve(tetuVault, 0);
        IERC20(underlying).approve(tetuVault, balance);

        // invest to tetuVault
        console.log("invest deposit");
        console.log("underlying: %s", underlying);
        console.log("tetuVault: %s", tetuVault);

        ISmartVault(tetuVault).deposit(balance);
        console.log("invest > AUM: %s", _getAUM());
        console.log("invested %s of  %s", balance, underlying);
        return balance;
    }

    /**
     * @dev Withdraws capital out of Iron
     * @param amountUnderlying - the amount to withdraw
     * @return the number of tokens to return to the tetuVault
     */
    function _divest(uint256 amountUnderlying, uint256) internal override returns (uint256) {
        amountUnderlying = amountUnderlying + 100;

        amountUnderlying = Math.min(amountUnderlying, _getAUM());
        console.log("_divest request amountUnderlying: %s", amountUnderlying);
        if (amountUnderlying > 0) {
            ISmartVault(tetuVault).withdraw(amountUnderlying);
        }
        console.log("AUM: %s", _getAUM());
        uint divested = IERC20(underlying).balanceOf(address(this));
        console.log("divested %s of  %s", divested, underlying);
        return divested;
    }

    /**
     * @dev Checks balance of managed assets
     */
    function _getAUM() internal view override returns (uint256) {
        return ISmartVault(tetuVault).underlyingBalanceWithInvestmentForHolder(address(this));
    }

//    /// @dev Claim all rewards from given tetuVault and send to pool/strategy
//    function claimRewards() public {
//        _claim();
//    }
//
//    /// @dev Claim all rewards from given tetuVault and send to pool/strategy
//    function _claim() private {
//        ISmartVault sv = ISmartVault(tetuVault);
//
//        for (uint i = 0; i < sv.rewardTokensLength(); i++) {
//            address rt = sv.rewardTokens()[i];
//            uint bal = IERC20(rt).balanceOf(address(this));
//            sv.getReward(rt);
//            uint claimed = IERC20(rt).balanceOf(address(this)) - bal;
//            if (claimed > 0) {
//                IERC20(rt).transfer(getPoolAddress(), claimed);
//            }
//        }
//    }
}
