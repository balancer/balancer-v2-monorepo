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

import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IRewardsOnlyGauge.sol";
import "@balancer-labs/v2-interfaces/contracts/liquidity-mining/IChildChainStreamer.sol";

contract ChildChainGaugeRewardHelper {
    uint256 public constant CLAIM_FREQUENCY = 3600;

    function claimRewardsFromGauge(IRewardsOnlyGauge gauge, address user) external {
        _claimRewardsFromGauge(gauge, user);
    }

    function claimRewardsFromGauges(IRewardsOnlyGauge[] calldata gauges, address user) external {
        for (uint256 i = 0; i < gauges.length; i++) {
            _claimRewardsFromGauge(gauges[i], user);
        }
    }

    function _claimRewardsFromGauge(IRewardsOnlyGauge gauge, address user) internal {
        if (gauge.last_claim() + CLAIM_FREQUENCY < block.timestamp) {
            gauge.claim_rewards(user);
        } else {
            // Force rewards from the streamer onto the gauge.
            gauge.reward_contract().get_reward();
            gauge.claim_rewards(user);
        }
    }

    function pendingRewards(
        IRewardsOnlyGauge gauge,
        address user,
        address token
    ) external returns (uint256) {
        gauge.reward_contract().get_reward();
        return gauge.claimable_reward_write(user, token);
    }
}
