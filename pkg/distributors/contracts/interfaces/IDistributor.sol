// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.7.0;

interface IDistributor {
    event RewardAdded(address indexed token, uint256 amount);
    event RewardPaid(address indexed user, address indexed rewardsToken, uint256 reward);
}
