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

import "./aave/ILendingPoolAddressesProvider.sol";
import "./aave/ILendingPool.sol";
import "./aave/IAaveIncentivesController.sol";

import "./RewardsAssetManager.sol";
import "@balancer-labs/v2-distributors/contracts/interfaces/IMultiRewards.sol";

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

contract AaveATokenAssetManager is RewardsAssetManager {
    uint16 public constant REFERRAL_CODE = 0;

    IAaveIncentivesController public immutable aaveIncentives;
    ILendingPool public immutable lendingPool;
    IERC20 public immutable aToken;
    IERC20 public immutable stkAave;

    // @notice rewards distributor for pool which owns this asset manager
    IMultiRewards public distributor;

    constructor(
        IVault vault,
        IERC20 token,
        ILendingPool _lendingPool,
        IAaveIncentivesController _aaveIncentives
    ) RewardsAssetManager(vault, bytes32(0), token) {
        // Query aToken addresses from lending pool
        lendingPool = _lendingPool;
        aToken = IERC20(_lendingPool.getReserveData(address(token)).aTokenAddress);

        // Query reward token from incentives contract
        aaveIncentives = _aaveIncentives;
        stkAave = IERC20(_aaveIncentives.REWARD_TOKEN());

        token.approve(address(_lendingPool), type(uint256).max);
    }

    /**
     * @dev Should be called in same transaction as deployment through a factory contract
     * @param poolId - the id of the pool
     * @param rewardsDistributor - the address of the rewards contract (to distribute stkAAVE)
     */
    function initialize(bytes32 poolId, address rewardsDistributor) public {
        _initialize(poolId);

        distributor = IMultiRewards(rewardsDistributor);
        IERC20 poolAddress = IERC20(uint256(poolId) >> (12 * 8));
        distributor.allowlistRewarder(poolAddress, stkAave, address(this));
        distributor.addReward(poolAddress, stkAave, 1);

        stkAave.approve(rewardsDistributor, type(uint256).max);
    }

    /**
     * @dev Deposits capital into Aave
     * @param amount - the amount of tokens being deposited
     * @return the amount deposited
     */
    function _invest(uint256 amount, uint256) internal override returns (uint256) {
        lendingPool.deposit(address(getToken()), amount, address(this), REFERRAL_CODE);
        return amount;
    }

    /**
     * @dev Withdraws capital out of Aave
     * @param amount - the amount to withdraw
     * @return the number of tokens to return to the vault
     */
    function _divest(uint256 amount, uint256) internal override returns (uint256) {
        return lendingPool.withdraw(address(getToken()), amount, address(this));
    }

    /**
     * @dev Checks AToken balance (ever growing)
     */
    function _getAUM() internal view override returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    function claimRewards() public {
        // Claim stkAave from incentives controller
        address[] memory assets = new address[](1);
        assets[0] = address(aToken);
        aaveIncentives.claimRewards(assets, type(uint256).max, address(this));

        // Forward to distributor
        distributor.notifyRewardAmount(
            IERC20(getPoolAddress()),
            stkAave,
            stkAave.balanceOf(address(this)),
            address(this)
        );
    }
}
