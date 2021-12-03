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
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";

import "./IDistributorCallback.sol";

interface IMultiDistributor {
    struct DistributionChannel {
        IERC20 stakingToken;
        IERC20 distributionToken;
        address owner;
        uint256 totalSupply;
        uint256 duration;
        uint256 periodFinish;
        uint256 paymentRate;
        uint256 lastUpdateTime;
        uint256 globalTokensPerStake;
    }

    struct UserDistributionInfo {
        uint256 unclaimedTokens;
        uint256 userTokensPerStake;
    }

    struct UserStaking {
        uint256 balance;
        EnumerableSet.Bytes32Set subscribedDistributions;
        mapping(bytes32 => UserDistributionInfo) distributionInfo;
    }

    event Staked(bytes32 indexed distributionChannel, address indexed user, uint256 amount);
    event Unstaked(bytes32 indexed distributionChannel, address indexed user, uint256 amount);
    event DistributionChannelCreated(
        bytes32 indexed distributionChannel,
        IERC20 stakingToken,
        IERC20 distributionToken,
        address owner
    );
    event DistributionDurationSet(bytes32 indexed distributionChannel, uint256 duration);
    event DistributionFunded(bytes32 indexed distributionChannel, uint256 amount);
    event TokensClaimed(address indexed user, address indexed rewardToken, uint256 amount);

    // Getters

    function getDistributionChannelId(
        IERC20 stakingToken,
        IERC20 distributionToken,
        address owner
    ) external pure returns (bytes32);

    function getDistributionChannel(bytes32 distributionChannelId) external view returns (DistributionChannel memory);

    function globalTokensPerStake(bytes32 distributionChannelId) external view returns (uint256);

    function totalSupply(bytes32 distributionChannelId) external view returns (uint256);

    function isSubscribed(bytes32 distributionChannelId, address user) external view returns (bool);

    function getUserDistributionInfo(bytes32 distributionChannelId, address user)
        external
        view
        returns (UserDistributionInfo memory);

    function getClaimableTokens(bytes32 distributionChannelId, address user) external view returns (uint256);

    function balanceOf(IERC20 stakingToken, address user) external view returns (uint256);

    // Distribution Management

    function createDistribution(
        IERC20 stakingToken,
        IERC20 distributionToken,
        uint256 duration
    ) external returns (bytes32 distributionChannelId);

    function fundDistribution(bytes32 distributionChannelId, uint256 amount) external;

    function setDistributionDuration(bytes32 distributionChannelId, uint256 duration) external;

    // Staking

    function stake(
        IERC20 stakingToken,
        uint256 amount,
        address sender,
        address recipient
    ) external;

    function stakeUsingVault(
        IERC20 stakingToken,
        uint256 amount,
        address sender,
        address recipient
    ) external;

    function stakeWithPermit(
        IERC20 stakingToken,
        uint256 amount,
        address user,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    // Subscription

    function subscribeDistributions(bytes32[] memory distributionChannelIds) external;

    function unsubscribeDistributions(bytes32[] memory distributionChannelIds) external;

    // Unstaking

    function unstake(
        IERC20 stakingToken,
        uint256 amount,
        address sender,
        address recipient
    ) external;

    function exit(IERC20[] memory stakingTokens, bytes32[] memory distributionIds) external;

    function exitWithCallback(
        IERC20[] memory stakingTokens,
        bytes32[] memory distributionChannelIds,
        IDistributorCallback callbackContract,
        bytes memory callbackData
    ) external;

    // Claiming

    function claim(
        bytes32[] memory distributionChannelIds,
        bool toInternalBalance,
        address sender,
        address recipient
    ) external;

    function claimWithCallback(
        bytes32[] memory distributionChannelIds,
        address sender,
        IDistributorCallback callbackContract,
        bytes memory callbackData
    ) external;
}
