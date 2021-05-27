// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.7.0;

interface IMultiRewards {
    function notifyRewardAmount(address _rewardsToken, uint256 reward) external;
}
