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

import "./SinglePoolAssetManager.sol";
import "@balancer-labs/v2-distributors/contracts/interfaces/IMultiRewards.sol";

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

// solhint-disable no-empty-blocks
// solhint-disable var-name-mixedcase
// solhint-disable private-vars-leading-underscore
contract SinglePoolAaveATokenAssetManager is SinglePoolAssetManager {
    uint16 private constant REFERRAL_CODE = 0;

    IAaveIncentivesController public immutable aaveIncentives;
    ILendingPool public immutable lendingPool;
    IERC20 public immutable aToken;
    IERC20 public immutable stkAave;

    /// @notice staking contract for pool which owns this asset manager
    IMultiRewards public distributor;

    constructor(
        IVault _vault,
        address _token,
        address _lendingPool,
        address _aToken,
        address _aaveIncentives,
        address _stkAave
    ) SinglePoolAssetManager(_vault, bytes32(0), _token) {
        // TODO: pull these from Aave addresses provider
        lendingPool = ILendingPool(_lendingPool);
        aToken = IERC20(_aToken);

        aaveIncentives = IAaveIncentivesController(_aaveIncentives);
        stkAave = IERC20(_stkAave);

        IERC20(_token).approve(_lendingPool, type(uint256).max);
    }

    /**
     * @dev Should be called in same transaction as deployment through a factory contract
     * @param pId - the id of the pool
     * @param rewardsDistributor - the address of the rewards contract (to distribute stkAAVE)
     */
    function initialise(bytes32 pId, address rewardsDistributor) public {
        require(poolId == bytes32(0), "Already initialised");
        poolId = pId;
        distributor = IMultiRewards(rewardsDistributor);
        IERC20(stkAave).approve(rewardsDistributor, type(uint256).max);
    }

    /**
     * @dev Deposits capital into Aave
     * @param amount - the amount of tokens being deposited
     * @param aum - the current assets under management of this asset manager
     * @return the number of shares to mint for the pool
     */
    function _invest(uint256 amount, uint256 aum) internal override returns (uint256) {
        lendingPool.deposit(address(token), amount, address(this), REFERRAL_CODE);
        if (aum == 0) {
            return amount;
        }
        return amount / aum;
    }

    /**
     * @dev Withdraws capital out of Aave
     * @param amount - the amount to withdraw
     * @return the number of tokens to return to the vault
     */
    function _divest(uint256 amount, uint256) internal override returns (uint256) {
        return lendingPool.withdraw(address(token), amount, address(this));
    }

    /**
     * @dev Checks AToken balance (ever growing)
     */
    function readAUM() public view override returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    function claimRewards() public {
        // Claim stkAave from incentives controller
        address[] memory assets = new address[](1);
        assets[0] = address(aToken);
        aaveIncentives.claimRewards(assets, type(uint256).max, address(this), true);

        // Forward to staking contract
        distributor.notifyRewardAmount(stkAave, stkAave.balanceOf(address(this)));
    }
}
