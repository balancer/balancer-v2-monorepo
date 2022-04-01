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

/**
 * @dev This contract is designed to mock LiquidityGaugeV5's interface for distributing external tokens.
 */
contract MockRewardTokenDistributor {
    struct Reward {
        IERC20 token;
        address distributor;
        uint256 period_finish;
        uint256 rate;
        uint256 last_update;
        uint256 integral;
    }

    uint256 _rewardCount;
    IERC20[8] private _rewardTokens;
    mapping(IERC20 => Reward) private _rewardData;

    function reward_tokens(uint256 index) external view returns (IERC20) {
        return _rewardTokens[index];
    }

    function reward_data(IERC20 token) external view returns (Reward memory) {
        return _rewardData[token];
    }

    function add_reward(IERC20 rewardToken, address distributor) external {
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

    function set_reward_distributor(IERC20 rewardToken, address distributor) external {
        _rewardData[rewardToken].distributor = distributor;
    }

    function deposit_reward_tokens(IERC20 rewardToken, uint256 amount) external {
        require(_rewardData[rewardToken].distributor == msg.sender, "Only callable by reward distributor");
        rewardToken.transferFrom(msg.sender, address(this), amount);

        // We don't care about the rest of the update.
    }
}
