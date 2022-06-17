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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IRewardTokenDistributor.sol";

// solhint-disable func-name-mixedcase, var-name-mixedcase, not-rely-on-time

/**
 * @dev This contract is designed to mock LiquidityGaugeV5's interface for distributing external tokens.
 */
contract MockRewardTokenDistributor is IRewardTokenDistributor {
    uint256 private _rewardCount;
    IERC20[8] private _rewardTokens;
    mapping(IERC20 => Reward) private _rewardData;

    function reward_tokens(uint256 index) external view override returns (IERC20) {
        return _rewardTokens[index];
    }

    function reward_data(IERC20 token) external view override returns (Reward memory) {
        return _rewardData[token];
    }

    function add_reward(IERC20 rewardToken, address distributor) external override {
        _rewardTokens[_rewardCount] = rewardToken;
        _rewardData[rewardToken] = Reward({
            token: rewardToken,
            distributor: distributor,
            period_finish: 0,
            rate: 0,
            last_update: block.timestamp,
            integral: 0
        });

        _rewardCount += 1;
        require(_rewardCount < 8, "Too many reward tokens");
    }

    function set_reward_distributor(IERC20 rewardToken, address distributor) external override {
        _rewardData[rewardToken].distributor = distributor;
    }

    function deposit_reward_token(IERC20 rewardToken, uint256 amount) external override {
        require(_rewardData[rewardToken].distributor == msg.sender, "Only callable by reward distributor");
        rewardToken.transferFrom(msg.sender, address(this), amount);

        // We don't care about the rest of the update.
    }

    function claim_rewards(address user) external override {
        // solhint-disable-previous-line no-empty-blocks
    }

    function claimable_reward(address, address) external pure override returns (uint256) {
        return 0;
    }

    function claimable_reward_write(address, address) external pure override returns (uint256) {
        return 0;
    }
}
