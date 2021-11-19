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
    /**
     * @dev The Distribution struct has its fields packed to minimise the number of storage reads/writes.
     * Timestamps are stored in 64 bits which ensures that the Sun will explode before they overflow.
     * `globalTokensPerStake` and `paymentRate` are stored as 18 decimal fixed point numbers,
     * leaving 128 bits for the integer component allowing us to store values of up to ~10^38
     *
     * Slot 1
     *  - IERC20 stakingToken;
     * Slot 2
     *  - IERC20 distributionToken;
     * Slot 3
     *  - address owner;
     *  - uint64 duration;
     * Slot 4
     *  - uint256 totalSupply;
     * Slot 5 (fields always written to together)
     *  - uint192 paymentRate;
     *  - uint64 periodFinish;
     * Slot 6 (fields always written to together)
     *  - uint192 globalTokensPerStake;
     *  - uint64 lastUpdateTime;
     */
    struct Distribution {
        IERC20 stakingToken;
        IERC20 distributionToken;
        address owner;
        uint64 duration;
        uint256 totalSupply;
        uint192 paymentRate;
        uint64 periodFinish;
        uint192 globalTokensPerStake;
        uint64 lastUpdateTime;
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

    // Distribution Management

    function createDistribution(
        IERC20 stakingToken,
        IERC20 distributionToken,
        uint64 duration
    ) external returns (bytes32 distributionId);

    function fundDistribution(bytes32 distributionId, uint256 amount) external;

    function setDistributionDuration(bytes32 distributionId, uint64 duration) external;

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
