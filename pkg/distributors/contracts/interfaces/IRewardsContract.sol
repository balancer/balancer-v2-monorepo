pragma solidity ^0.7.0;

interface IRewardsContract {
    function notifyRewardAmount(address _rewardsToken, uint256 reward) external;
}
