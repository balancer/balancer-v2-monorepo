// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.7.0;
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";

interface IMultiRewards {
    function notifyRewardAmount(IERC20 _rewardsToken, uint256 reward) external;
}
