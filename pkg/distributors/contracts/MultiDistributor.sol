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

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/EnumerableSet.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20Permit.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAsset.sol";

import "./RewardsScheduler.sol";
import "./MultiDistributorAuthorization.sol";

import "./interfaces/IMultiDistributor.sol";
import "./interfaces/IDistributorCallback.sol";
import "./interfaces/IDistributor.sol";

// solhint-disable not-rely-on-time

/**
 * Balancer MultiDistributor claim contract (claim to internal balance) based on
 * Curve Finance's MultiRewards contract, updated to be compatible with solc 0.7.0
 * https://github.com/curvefi/multi-rewards/blob/master/contracts/MultiRewards.sol commit #9947623
 */

contract MultiDistributor is IMultiDistributor, IDistributor, ReentrancyGuard, MultiDistributorAuthorization {
    using FixedPoint for uint256;
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    struct Distribution {
        IERC20 stakingToken;
        IERC20 rewardsToken;
        address rewarder;
        uint256 totalSupply;
        uint256 duration;
        uint256 periodFinish;
        uint256 rewardRate;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
    }

    struct UserDistribution {
        uint256 unpaidRewards;
        uint256 paidRatePerToken;
    }

    struct UserStaking {
        uint256 balance;
        EnumerableSet.Bytes32Set subscribedDistributions;
        mapping(bytes32 => UserDistribution) distributions;
    }

    mapping(bytes32 => Distribution) internal _distributions;
    mapping(IERC20 => mapping(address => UserStaking)) internal _userStakings;

    event Staked(bytes32 indexed distribution, address indexed user, uint256 amount);
    event Withdrawn(bytes32 indexed distribution, address indexed user, uint256 amount);
    event NewDistribution(bytes32 indexed distribution, IERC20 stakingToken, IERC20 rewardsToken, address rewarder);
    event DistributionDurationSet(bytes32 indexed distribution, uint256 duration);
    event RewardAdded(bytes32 indexed distribution, uint256 amount);

    /**
     * @notice Updates the reward rate for all the distributions a user has signed up for
     */
    modifier updateDistribution(IERC20 stakingToken, address user) {
        _updateDistribution(stakingToken, user);
        _;
    }

    constructor(IVault vault) Authentication(bytes32(uint256(address(this)))) MultiDistributorAuthorization(vault) {
        // solhint-disable-previous-line no-empty-blocks
        // MultiDistributor is a singleton, so it simply uses its own address to disambiguate action identifiers
    }

    /**
     * @dev Tells the identifier used for a specific distribution
     * @param stakingToken The staking token of the distribution
     * @param rewardsToken The rewards token of the distribution
     * @param rewarder The rewarder of the distribution
     */
    function getDistributionId(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        address rewarder
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(stakingToken, rewardsToken, rewarder));
    }

    /**
     * @dev Tells the information of a distribution
     * @param distributionId ID of the distribution being queried
     */
    function getDistribution(bytes32 distributionId) external view returns (Distribution memory) {
        return _getDistribution(distributionId);
    }

    /**
     * @dev Calculates the reward rate per token for a distribution
     * @param distributionId ID of the distribution being queried
     */
    function rewardPerToken(bytes32 distributionId) public view returns (uint256) {
        return _rewardPerToken(_getDistribution(distributionId));
    }

    /**
     * @dev Tells the total supply for a staking token
     * @param distributionId ID of the distribution being queried
     */
    function totalSupply(bytes32 distributionId) external view returns (uint256) {
        return _getDistribution(distributionId).totalSupply;
    }

    /**
     * @dev Tell the time until when a reward has been accounted for
     * @param distributionId ID of the distribution being queried
     */
    function lastTimeRewardApplicable(bytes32 distributionId) public view returns (uint256) {
        return _lastTimeRewardApplicable(_getDistribution(distributionId));
    }

    /**
     * @dev Tells if a user is subscribed to a distribution or not
     * @param distributionId ID of the distribution being queried
     * @param user The address of the user being queried
     */
    function isSubscribed(bytes32 distributionId, address user) external view returns (bool) {
        IERC20 stakingToken = _getDistribution(distributionId).stakingToken;
        return _userStakings[stakingToken][user].subscribedDistributions.contains(distributionId);
    }

    /**
     * @dev Tells the information of a distribution for a user
     * @param distributionId ID of the distribution being queried
     * @param user Address of the user being queried
     */
    function getUserDistribution(bytes32 distributionId, address user) external view returns (UserDistribution memory) {
        IERC20 stakingToken = _getDistribution(distributionId).stakingToken;
        return _userStakings[stakingToken][user].distributions[distributionId];
    }

    /**
     * @dev Calculates the rewards amount that a user is able to claim for a particular distribution
     * @param distributionId ID of the distribution being queried
     * @param user The address receiving the rewards
     */
    function unaccountedEarned(bytes32 distributionId, address user) external view returns (uint256) {
        IERC20 stakingToken = _getDistribution(distributionId).stakingToken;
        UserStaking storage userStaking = _userStakings[stakingToken][user];
        return _unaccountedEarned(userStaking, distributionId);
    }

    /**
     * @dev Calculates the total rewards amount that a user is able to claim for a distribution
     * @param distributionId ID of the distribution being queried
     * @param user The address receiving the rewards
     */
    function totalEarned(bytes32 distributionId, address user) external view returns (uint256) {
        IERC20 stakingToken = _getDistribution(distributionId).stakingToken;
        UserStaking storage userStaking = _userStakings[stakingToken][user];
        return _totalEarned(userStaking, distributionId);
    }

    /**
     * @dev Tells the staked balance of a user for a staking token
     * @param stakingToken The staking token being queried
     * @param user The address of the user with staked balance
     */
    function balanceOf(IERC20 stakingToken, address user) external view returns (uint256) {
        return _userStakings[stakingToken][user].balance;
    }

    /**
     * @notice Adds a new reward token to be distributed
     * @param stakingToken The staking token that will receive rewards
     * @param rewardsToken The new token to be distributed to users
     * @param duration The duration over which each distribution is spread
     */
    function create(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        uint256 duration
    ) external override returns (bytes32 distributionId) {
        require(duration > 0, "DISTRIBUTION_DURATION_ZERO");
        require(address(stakingToken) != address(0), "STAKING_TOKEN_ZERO_ADDRESS");
        require(address(rewardsToken) != address(0), "REWARDS_TOKEN_ZERO_ADDRESS");

        distributionId = getDistributionId(stakingToken, rewardsToken, msg.sender);
        Distribution storage distribution = _getDistribution(distributionId);
        require(distribution.duration == 0, "DISTRIBUTION_ALREADY_CREATED");
        distribution.duration = duration;
        distribution.rewarder = msg.sender;
        distribution.rewardsToken = rewardsToken;
        distribution.stakingToken = stakingToken;

        emit NewDistribution(distributionId, stakingToken, rewardsToken, msg.sender);
    }

    /**
     * @notice Set the reward duration for a reward
     * @param distributionId ID of the distribution to be set
     * @param duration The duration over which each distribution is spread
     */
    function setDistributionDuration(bytes32 distributionId, uint256 duration) external {
        require(duration > 0, "DISTRIBUTION_DURATION_ZERO");

        Distribution storage distribution = _getDistribution(distributionId);
        require(distribution.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");
        require(distribution.rewarder == msg.sender, "SENDER_NOT_REWARDER");
        require(distribution.periodFinish < block.timestamp, "DISTRIBUTION_STILL_ACTIVE");

        distribution.duration = duration;
        emit DistributionDurationSet(distributionId, duration);
    }

    /**
     * @dev Allows a distributor to deposit more tokens to be distributed as rewards
     * @param distributionId ID of the distribution to be rewarded
     * @param amount The amount of tokens to deposit
     */
    function reward(bytes32 distributionId, uint256 amount) external override {
        _updateDistributionRate(distributionId);

        Distribution storage distribution = _getDistribution(distributionId);
        require(distribution.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");
        require(distribution.rewarder == msg.sender, "SENDER_NOT_REWARDER");

        IERC20 rewardsToken = distribution.rewardsToken;
        rewardsToken.safeTransferFrom(msg.sender, address(this), amount);
        rewardsToken.approve(address(getVault()), amount);

        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);
        ops[0] = IVault.UserBalanceOp({
            asset: IAsset(address(rewardsToken)),
            amount: amount,
            sender: address(this),
            recipient: payable(address(this)),
            kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
        });

        getVault().manageUserBalance(ops);

        uint256 duration = distribution.duration;
        uint256 periodFinish = distribution.periodFinish;

        if (block.timestamp >= periodFinish) {
            distribution.rewardRate = Math.divDown(amount, duration);
        } else {
            // Checked arithmetic is not required due to the if
            uint256 remainingTime = periodFinish - block.timestamp;
            uint256 leftoverRewards = Math.mul(remainingTime, distribution.rewardRate);
            distribution.rewardRate = Math.divDown(amount.add(leftoverRewards), duration);
        }

        distribution.lastUpdateTime = block.timestamp;
        distribution.periodFinish = block.timestamp.add(duration);
        emit RewardAdded(distributionId, amount);
    }

    function subscribe(bytes32[] memory distributionIds) external {
        for (uint256 i; i < distributionIds.length; i++) {
            bytes32 distributionId = distributionIds[i];
            Distribution storage distribution = _getDistribution(distributionId);
            require(distribution.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");

            IERC20 stakingToken = distribution.stakingToken;
            UserStaking storage userStaking = _userStakings[stakingToken][msg.sender];
            EnumerableSet.Bytes32Set storage subscribedDistributions = userStaking.subscribedDistributions;
            require(!subscribedDistributions.contains(distributionId), "ALREADY_SUBSCRIBED_DISTRIBUTION");

            uint256 amount = userStaking.balance;
            if (amount == 0) userStaking.subscribedDistributions.add(distributionId);
            else {
                userStaking.subscribedDistributions.add(distributionId);
                // The unpaid rewards remains the same because was not subscribed to the distribution
                userStaking.distributions[distributionId].paidRatePerToken = _updateDistributionRate(distributionId);
                distribution.totalSupply = distribution.totalSupply.add(amount);
                emit Staked(distributionId, msg.sender, amount);
            }
        }
    }

    function unsubscribe(bytes32[] memory distributionIds) external {
        for (uint256 i; i < distributionIds.length; i++) {
            bytes32 distributionId = distributionIds[i];
            Distribution storage distribution = _getDistribution(distributionId);
            require(distribution.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");

            UserStaking storage userStaking = _userStakings[distribution.stakingToken][msg.sender];
            EnumerableSet.Bytes32Set storage subscribedDistributions = userStaking.subscribedDistributions;
            require(subscribedDistributions.contains(distributionId), "DISTRIBUTION_NOT_SUBSCRIBED");

            uint256 amount = userStaking.balance;
            if (amount == 0) userStaking.subscribedDistributions.remove(distributionId);
            else {
                _updateUserRewardRatePerToken(userStaking, distributionId);
                userStaking.subscribedDistributions.remove(distributionId);
                distribution.totalSupply = distribution.totalSupply.sub(amount);
                emit Withdrawn(distributionId, msg.sender, amount);
            }
        }
    }

    /**
     * @notice Stakes a token on the msg.sender's behalf
     * @param stakingToken The token to be staked to earn rewards
     * @param amount Amount of tokens to be staked
     */
    function stake(IERC20 stakingToken, uint256 amount) external nonReentrant {
        _stakeFor(stakingToken, amount, msg.sender, msg.sender);
    }

    /**
     * @notice Stakes a token so that `user` can earn rewards
     * @param stakingToken The token to be staked to earn rewards
     * @param amount Amount of tokens to be staked
     * @param user The user staking on behalf of
     */
    function stakeFor(
        IERC20 stakingToken,
        uint256 amount,
        address user
    ) external nonReentrant {
        _stakeFor(stakingToken, amount, user, msg.sender);
    }

    /**
     * @notice Stake tokens using a permit signature for approval
     * @param stakingToken The token to be staked to earn rewards
     * @param user User staking tokens for
     * @param amount Amount of tokens to be staked
     * @param deadline The time at which this expires (unix time)
     * @param v V of the signature
     * @param r R of the signature
     * @param s S of the signature
     */
    function stakeWithPermit(
        IERC20 stakingToken,
        uint256 amount,
        address user,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        IERC20Permit(address(stakingToken)).permit(user, address(this), amount, deadline, v, r, s);
        _stakeFor(stakingToken, amount, user, user);
    }

    /**
     * @notice Withdraw tokens
     * @param stakingToken The token to be withdrawn
     * @param amount Amount of tokens to be withdrawn
     * @param receiver The recipient of the staked tokens
     */
    function withdraw(
        IERC20 stakingToken,
        uint256 amount,
        address receiver
    ) public nonReentrant updateDistribution(stakingToken, msg.sender) {
        require(amount > 0, "WITHDRAW_AMOUNT_ZERO");

        UserStaking storage userStaking = _userStakings[stakingToken][msg.sender];
        uint256 currentBalance = userStaking.balance;
        require(currentBalance >= amount, "WITHDRAW_AMOUNT_UNAVAILABLE");
        userStaking.balance = userStaking.balance.sub(amount);

        EnumerableSet.Bytes32Set storage distributions = userStaking.subscribedDistributions;
        uint256 distributionsLength = distributions.length();

        for (uint256 i; i < distributionsLength; i++) {
            bytes32 distributionId = distributions.unchecked_at(i);
            Distribution storage distribution = _getDistribution(distributionId);
            distribution.totalSupply = distribution.totalSupply.sub(amount);
            emit Withdrawn(distributionId, msg.sender, amount);
        }

        stakingToken.safeTransfer(receiver, amount);
    }

    /**
     * @dev Allows a user to claim any rewards to an EOA
     * @param distributionIds List of distributions claiming the rewards of
     */
    function claim(bytes32[] memory distributionIds) external nonReentrant {
        _claim(distributionIds, msg.sender, IVault.UserBalanceOpKind.WITHDRAW_INTERNAL);
    }

    /**
     * @notice Allows a user to claim any rewards to an internal balance
     * @param distributionIds The distributions to claim rewards for
     */
    function claimAsInternalBalance(bytes32[] memory distributionIds) external nonReentrant {
        _claim(distributionIds, msg.sender, IVault.UserBalanceOpKind.TRANSFER_INTERNAL);
    }

    /**
     * @notice Allows the user to claim rewards to a callback contract
     * @param distributionIds The distributions to claim rewards for
     * @param callbackContract The contract where rewards will be transferred
     * @param callbackData The data that is used to call the callback contract's 'callback' method
     */
    function claimWithCallback(
        bytes32[] memory distributionIds,
        IDistributorCallback callbackContract,
        bytes memory callbackData
    ) external nonReentrant {
        _claim(distributionIds, address(callbackContract), IVault.UserBalanceOpKind.TRANSFER_INTERNAL);
        callbackContract.distributorCallback(callbackData);
    }

    /**
     * @notice Allows a user to withdraw all their tokens
     * @param stakingTokens The staking tokens to withdraw tokens from
     * @param distributionIds The distributions to claim rewards for
     */
    function exit(IERC20[] memory stakingTokens, bytes32[] memory distributionIds) external {
        for (uint256 i; i < stakingTokens.length; i++) {
            IERC20 stakingToken = stakingTokens[i];
            UserStaking storage userStaking = _userStakings[stakingToken][msg.sender];
            withdraw(stakingToken, userStaking.balance, msg.sender);
        }

        _claim(distributionIds, msg.sender, IVault.UserBalanceOpKind.WITHDRAW_INTERNAL);
    }

    /**
     * @notice Allows a user to withdraw transferring rewards to a callback contract
     * @param stakingTokens The staking tokens to withdraw tokens from
     * @param distributionIds The distributions to claim rewards for
     * @param callbackContract The contract where the rewards tokens will be transferred
     * @param callbackData The data that is used to call the callback contract's 'callback' method
     */
    function exitWithCallback(
        IERC20[] memory stakingTokens,
        bytes32[] memory distributionIds,
        IDistributorCallback callbackContract,
        bytes memory callbackData
    ) external {
        for (uint256 i; i < stakingTokens.length; i++) {
            IERC20 stakingToken = stakingTokens[i];
            UserStaking storage userStaking = _userStakings[stakingToken][msg.sender];
            withdraw(stakingToken, userStaking.balance, msg.sender);
        }

        _claim(distributionIds, address(callbackContract), IVault.UserBalanceOpKind.TRANSFER_INTERNAL);
        callbackContract.distributorCallback(callbackData);
    }

    function _stakeFor(
        IERC20 stakingToken,
        uint256 amount,
        address user,
        address from
    ) internal updateDistribution(stakingToken, user) {
        require(amount > 0, "STAKE_AMOUNT_ZERO");

        UserStaking storage userStaking = _userStakings[stakingToken][user];
        userStaking.balance = userStaking.balance.add(amount);

        EnumerableSet.Bytes32Set storage distributions = userStaking.subscribedDistributions;
        uint256 distributionsLength = distributions.length();

        for (uint256 i; i < distributionsLength; i++) {
            bytes32 distributionId = distributions.unchecked_at(i);
            Distribution storage distribution = _getDistribution(distributionId);
            distribution.totalSupply = distribution.totalSupply.add(amount);
            emit Staked(distributionId, user, amount);
        }

        stakingToken.safeTransferFrom(from, address(this), amount);
    }

    /**
     * @notice Allows a user to claim any rewards to an internal balance or EOA
     */
    function _claim(
        bytes32[] memory distributionIds,
        address recipient,
        IVault.UserBalanceOpKind kind
    ) internal {
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](distributionIds.length);

        for (uint256 i; i < distributionIds.length; i++) {
            bytes32 distributionId = distributionIds[i];
            Distribution storage distribution = _getDistribution(distributionId);

            IERC20 stakingToken = distribution.stakingToken;
            UserStaking storage userStaking = _userStakings[stakingToken][msg.sender];

            if (userStaking.subscribedDistributions.contains(distributionId)) {
                // Update user distribution rates only if the user is still subscribed
                _updateUserRewardRatePerToken(userStaking, distributionId);
            }

            UserDistribution storage userDistribution = userStaking.distributions[distributionId];
            uint256 unpaidRewards = userDistribution.unpaidRewards;
            address rewardsToken = address(distribution.rewardsToken);

            if (unpaidRewards > 0) {
                userDistribution.unpaidRewards = 0;
                emit RewardPaid(msg.sender, rewardsToken, unpaidRewards);
            }

            ops[i] = IVault.UserBalanceOp({
                asset: IAsset(rewardsToken),
                amount: unpaidRewards,
                sender: address(this),
                recipient: payable(recipient),
                kind: kind
            });
        }

        getVault().manageUserBalance(ops);
    }

    function _updateDistribution(IERC20 stakingToken, address user) internal {
        UserStaking storage userStaking = _userStakings[stakingToken][user];
        EnumerableSet.Bytes32Set storage distributions = userStaking.subscribedDistributions;
        uint256 distributionsLength = distributions.length();

        for (uint256 i; i < distributionsLength; i++) {
            bytes32 distributionId = distributions.unchecked_at(i);
            _updateUserRewardRatePerToken(userStaking, distributionId);
        }
    }

    /**
     * @notice Updates unpaid rewards due to a user
     */
    function _updateUserRewardRatePerToken(UserStaking storage userStaking, bytes32 distributionId) internal {
        uint256 rewardPerTokenStored = _updateDistributionRate(distributionId);
        UserDistribution storage userDistribution = userStaking.distributions[distributionId];
        userDistribution.unpaidRewards = _totalEarned(userStaking, distributionId);
        userDistribution.paidRatePerToken = rewardPerTokenStored;
    }

    /**
     * @notice Updates the reward per staked token rate of a distribution
     */
    function _updateDistributionRate(bytes32 distributionId) internal returns (uint256 rewardPerTokenStored) {
        Distribution storage distribution = _getDistribution(distributionId);
        rewardPerTokenStored = _rewardPerToken(distribution);
        distribution.rewardPerTokenStored = rewardPerTokenStored;
        distribution.lastUpdateTime = _lastTimeRewardApplicable(distribution);
    }

    function _rewardPerToken(Distribution storage distribution) internal view returns (uint256) {
        uint256 supply = distribution.totalSupply;
        if (supply == 0) {
            return distribution.rewardPerTokenStored;
        }

        // Underflow is impossible here because lastTimeRewardApplicable(...) is always greater than last update time
        uint256 unrewardedDuration = _lastTimeRewardApplicable(distribution) - distribution.lastUpdateTime;
        uint256 unrewardedRatePerToken = Math.mul(unrewardedDuration, distribution.rewardRate).divDown(supply);
        return distribution.rewardPerTokenStored.add(unrewardedRatePerToken);
    }

    function _lastTimeRewardApplicable(Distribution storage distribution) internal view returns (uint256) {
        return Math.min(block.timestamp, distribution.periodFinish);
    }

    function _totalEarned(UserStaking storage userStaking, bytes32 distributionId) internal view returns (uint256) {
        uint256 unpaidRewards = userStaking.distributions[distributionId].unpaidRewards;
        return _unaccountedEarned(userStaking, distributionId).add(unpaidRewards);
    }

    function _unaccountedEarned(UserStaking storage userStaking, bytes32 distributionId)
        internal
        view
        returns (uint256)
    {
        // If the user is not subscribed to the queried distribution, it should be handled as if the user has no stake.
        // Then, it can be short cut to zero.
        if (!userStaking.subscribedDistributions.contains(distributionId)) {
            return 0;
        }

        uint256 paidRatePerToken = userStaking.distributions[distributionId].paidRatePerToken;
        uint256 totalRewardPerToken = _rewardPerToken(_getDistribution(distributionId)).sub(paidRatePerToken);
        return userStaking.balance.mulDown(totalRewardPerToken);
    }

    function _getDistribution(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        address rewarder
    ) internal view returns (Distribution storage) {
        return _getDistribution(getDistributionId(stakingToken, rewardsToken, rewarder));
    }

    function _getDistribution(bytes32 id) internal view returns (Distribution storage) {
        return _distributions[id];
    }
}
