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

import "./ILiquidityGauge.sol";

// For compatibility, we're keeping the same function names as in the original Curve code, including the mixed-case
// naming convention.
// solhint-disable func-name-mixedcase

interface IStakingLiquidityGauge is ILiquidityGauge, IERC20 {
    struct Reward {
        address token;
        address distributor;
        uint256 period_finish;
        uint256 rate;
        uint256 last_update;
        uint256 integral;
    }

    function initialize(address lpToken) external;

    function lp_token() external view returns (IERC20);

    function reward_tokens(uint256 index) external view returns (IERC20);

    function reward_data(IERC20 token) external view returns (Reward memory);

    function deposit(uint256 value, address recipient) external;

    function withdraw(uint256 value) external;

    function claim_rewards(address user) external;

    function add_reward(address rewardToken, address distributor) external;

    function set_reward_distributor(address rewardToken, address distributor) external;

    function deposit_reward_tokens(IERC20 rewardToken, uint256 amount) external;
}
