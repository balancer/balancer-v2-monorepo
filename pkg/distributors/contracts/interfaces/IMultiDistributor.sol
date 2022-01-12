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
    // paymentRate and globalTokensPerStake are stored as 18 decimal fixed point values
    struct Distribution {
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

    // userTokensPerStake is stored as an 18 decimal fixed point value
    struct UserDistribution {
        uint256 unclaimedTokens;
        uint256 userTokensPerStake;
    }

    struct UserStaking {
        uint256 balance;
        EnumerableSet.Bytes32Set subscribedDistributions;
        mapping(bytes32 => UserDistribution) distributions;
    }

    event Staked(bytes32 indexed distribution, address indexed user, uint256 amount);
    event Unstaked(bytes32 indexed distribution, address indexed user, uint256 amount);
    event DistributionCreated(
        bytes32 indexed distribution,
        IERC20 stakingToken,
        IERC20 distributionToken,
        address owner
    );
    event DistributionDurationSet(bytes32 indexed distribution, uint256 duration);
    event DistributionFunded(bytes32 indexed distribution, uint256 amount);
    event DistributionClaimed(bytes32 indexed distribution, address indexed user, uint256 amount);

    // Getters

    function getDistributionId(
        IERC20 stakingToken,
        IERC20 distributionToken,
        address owner
    ) external pure returns (bytes32);

    function getDistribution(bytes32 distributionId) external view returns (Distribution memory);

    function globalTokensPerStake(bytes32 distributionId) external view returns (uint256);

    function totalSupply(bytes32 distributionId) external view returns (uint256);

    function isSubscribed(bytes32 distributionId, address user) external view returns (bool);

    function getUserDistribution(bytes32 distributionId, address user) external view returns (UserDistribution memory);

    function getClaimableTokens(bytes32 distributionId, address user) external view returns (uint256);

    function balanceOf(IERC20 stakingToken, address user) external view returns (uint256);

    // Additionally, it is possible for an account to perform certain actions such as initiating a distribution or
    // claiming tokens on behalf of another account. These accounts are said to be 'relayers' for these
    // functions, and are expected to be smart contracts with sound authentication mechanisms.
    // For an account to be able to wield this power, two things must occur:
    //  - The Authorizer must grant the account the permission to be a relayer for the relevant MultiDistributor
    //    function. This means that Balancer governance must approve each individual contract to act as a relayer
    //    for the intended functions.
    //  - Each user must approve the relayer to act on their behalf.
    // This double protection means users cannot be tricked into approving malicious relayers (because they will not
    // have been allowed by the Authorizer via governance), nor can malicious relayers approved by a compromised
    // Authorizer or governance drain user funds, since they would also need to be approved by each individual user.

    // Distribution Management

    function createDistribution(
        IERC20 stakingToken,
        IERC20 distributionToken,
        uint256 duration
    ) external returns (bytes32 distributionId);

    function fundDistribution(bytes32 distributionId, uint256 amount) external;

    function setDistributionDuration(bytes32 distributionId, uint256 duration) external;

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

    function subscribeDistributions(bytes32[] memory distributionIds) external;

    function unsubscribeDistributions(bytes32[] memory distributionIds) external;

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
        bytes32[] memory distributionIds,
        IDistributorCallback callbackContract,
        bytes memory callbackData
    ) external;

    // Claiming

    function claim(
        bytes32[] memory distributionIds,
        bool toInternalBalance,
        address sender,
        address recipient
    ) external;

    function claimWithCallback(
        bytes32[] memory distributionIds,
        address sender,
        IDistributorCallback callbackContract,
        bytes memory callbackData
    ) external;
}
