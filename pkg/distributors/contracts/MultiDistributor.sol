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
        IERC20 distributionToken;
        address distributor;
        uint256 totalSupply;
        uint256 duration;
        uint256 periodFinish;
        uint256 paymentRate;
        uint256 lastUpdateTime;
        uint256 paymentPerTokenStored;
    }

    struct UserDistribution {
        uint256 unclaimedTokens;
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
    event NewDistribution(
        bytes32 indexed distribution,
        IERC20 stakingToken,
        IERC20 distributionToken,
        address rewarder
    );
    event DistributionDurationSet(bytes32 indexed distribution, uint256 duration);
    event RewardAdded(bytes32 indexed distribution, uint256 amount);

    /**
     * @dev Updates the reward rate for all the distributions that a user has signed up for a staking token
     */
    modifier updateDistributions(IERC20 stakingToken, address user) {
        _updateDistributions(stakingToken, user);
        _;
    }

    constructor(IVault vault) Authentication(bytes32(uint256(address(this)))) MultiDistributorAuthorization(vault) {
        // solhint-disable-previous-line no-empty-blocks
        // MultiDistributor is a singleton, so it simply uses its own address to disambiguate action identifiers
    }

    /**
     * @dev Returns the identifier used for a specific distribution
     * @param stakingToken The staking token of the distribution
     * @param distributionToken The token which is being distributed
     * @param rewarder The rewarder of the distribution
     */
    function getDistributionId(
        IERC20 stakingToken,
        IERC20 distributionToken,
        address rewarder
    ) public pure override returns (bytes32) {
        return keccak256(abi.encodePacked(stakingToken, distributionToken, rewarder));
    }

    /**
     * @dev Returns the information of a distribution
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
        return _paymentPerToken(_getDistribution(distributionId));
    }

    /**
     * @dev Returns the total supply for a distribution
     * @param distributionId ID of the distribution being queried
     */
    function totalSupply(bytes32 distributionId) external view returns (uint256) {
        return _getDistribution(distributionId).totalSupply;
    }

    /**
     * @dev Returns the time until when a reward has been accounted for
     * @param distributionId ID of the distribution being queried
     */
    function lastTimeRewardApplicable(bytes32 distributionId) public view returns (uint256) {
        return _lastTimeRewardApplicable(_getDistribution(distributionId));
    }

    /**
     * @dev Returns if a user is subscribed to a distribution or not
     * @param distributionId ID of the distribution being queried
     * @param user The address of the user being queried
     */
    function isSubscribed(bytes32 distributionId, address user) external view returns (bool) {
        IERC20 stakingToken = _getDistribution(distributionId).stakingToken;
        return _userStakings[stakingToken][user].subscribedDistributions.contains(distributionId);
    }

    /**
     * @dev Returns the information of a distribution for a user
     * @param distributionId ID of the distribution being queried
     * @param user Address of the user being queried
     */
    function getUserDistribution(bytes32 distributionId, address user) external view returns (UserDistribution memory) {
        IERC20 stakingToken = _getDistribution(distributionId).stakingToken;
        return _userStakings[stakingToken][user].distributions[distributionId];
    }

    /**
     * @dev Returns the unaccounted earned rewards for a user until now for a particular distribution
     * @param distributionId ID of the distribution being queried
     * @param user Address of the user being queried
     */
    function unaccountedEarned(bytes32 distributionId, address user) external view returns (uint256) {
        IERC20 stakingToken = _getDistribution(distributionId).stakingToken;
        UserStaking storage userStaking = _userStakings[stakingToken][user];
        return _unaccountedEarned(userStaking, distributionId);
    }

    /**
     * @dev Returns the total earned rewards for a user until now for a particular distribution
     * @param distributionId ID of the distribution being queried
     * @param user Address of the user being queried
     */
    function totalEarned(bytes32 distributionId, address user) external view returns (uint256) {
        IERC20 stakingToken = _getDistribution(distributionId).stakingToken;
        UserStaking storage userStaking = _userStakings[stakingToken][user];
        return _totalEarned(userStaking, distributionId);
    }

    /**
     * @dev Returns the staked balance of a user for a staking token
     * @param stakingToken The staking token being queried
     * @param user Address of the user being queried
     */
    function balanceOf(IERC20 stakingToken, address user) external view returns (uint256) {
        return _userStakings[stakingToken][user].balance;
    }

    /**
     * @dev Creates a new rewards distribution
     * @param stakingToken The staking token that will receive rewards
     * @param distributionToken The token to be distributed to users
     * @param duration The duration over which each distribution is spread
     */
    function create(
        IERC20 stakingToken,
        IERC20 distributionToken,
        uint256 duration
    ) external override returns (bytes32 distributionId) {
        require(duration > 0, "DISTRIBUTION_DURATION_ZERO");
        require(address(stakingToken) != address(0), "STAKING_TOKEN_ZERO_ADDRESS");
        require(address(distributionToken) != address(0), "REWARDS_TOKEN_ZERO_ADDRESS");

        distributionId = getDistributionId(stakingToken, distributionToken, msg.sender);
        Distribution storage distribution = _getDistribution(distributionId);
        require(distribution.duration == 0, "DISTRIBUTION_ALREADY_CREATED");
        distribution.duration = duration;
        distribution.distributor = msg.sender;
        distribution.distributionToken = distributionToken;
        distribution.stakingToken = stakingToken;

        emit NewDistribution(distributionId, stakingToken, distributionToken, msg.sender);
    }

    /**
     * @dev Sets the duration for a distribution
     * @param distributionId ID of the distribution to be set
     * @param duration Duration over which each distribution is spread
     */
    function setDistributionDuration(bytes32 distributionId, uint256 duration) external {
        require(duration > 0, "DISTRIBUTION_DURATION_ZERO");

        Distribution storage distribution = _getDistribution(distributionId);
        require(distribution.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");
        require(distribution.distributor == msg.sender, "SENDER_NOT_REWARDER");
        require(distribution.periodFinish < block.timestamp, "DISTRIBUTION_STILL_ACTIVE");

        distribution.duration = duration;
        emit DistributionDurationSet(distributionId, duration);
    }

    /**
     * @notice Deposits tokens to be distributed to stakers subscribed to distribution channel `distributionId`
     * @dev Starts a new distribution period for `duration` seconds from now.
     *      If the previous period is still active its undistributed tokens are rolled over into the new period.
     * @param distributionId ID of the distribution to be funded
     * @param amount The amount of tokens to deposit
     */
    function fundDistribution(bytes32 distributionId, uint256 amount) external override {
        _updateDistributionRate(distributionId);

        Distribution storage distribution = _getDistribution(distributionId);
        require(distribution.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");
        require(distribution.distributor == msg.sender, "SENDER_NOT_REWARDER");

        IERC20 distributionToken = distribution.distributionToken;
        distributionToken.safeTransferFrom(msg.sender, address(this), amount);
        distributionToken.approve(address(getVault()), amount);

        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);
        ops[0] = IVault.UserBalanceOp({
            asset: IAsset(address(distributionToken)),
            amount: amount,
            sender: address(this),
            recipient: payable(address(this)),
            kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
        });

        getVault().manageUserBalance(ops);

        uint256 duration = distribution.duration;
        uint256 periodFinish = distribution.periodFinish;

        if (block.timestamp >= periodFinish) {
            // Current distribution period has ended so new period consists only of amount provided.
            distribution.paymentRate = Math.divDown(amount, duration);
        } else {
            // Current distribution period is still in progress.
            // Calculate number of tokens which haven't been distributed yet and
            // apply these to the new distribution period being funded.

            // Checked arithmetic is not required due to the if
            uint256 remainingTime = periodFinish - block.timestamp;
            uint256 leftoverRewards = Math.mul(remainingTime, distribution.paymentRate);
            distribution.paymentRate = Math.divDown(amount.add(leftoverRewards), duration);
        }

        distribution.lastUpdateTime = block.timestamp;
        distribution.periodFinish = block.timestamp.add(duration);
        emit RewardAdded(distributionId, amount);
    }

    /**
     * @dev Subscribes a user to a list of distributions
     * @param distributionIds List of distributions to subscribe
     */
    function subscribe(bytes32[] memory distributionIds) external {
        for (uint256 i; i < distributionIds.length; i++) {
            bytes32 distributionId = distributionIds[i];
            Distribution storage distribution = _getDistribution(distributionId);
            require(distribution.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");

            IERC20 stakingToken = distribution.stakingToken;
            UserStaking storage userStaking = _userStakings[stakingToken][msg.sender];
            EnumerableSet.Bytes32Set storage subscribedDistributions = userStaking.subscribedDistributions;
            require(subscribedDistributions.add(distributionId), "ALREADY_SUBSCRIBED_DISTRIBUTION");

            uint256 amount = userStaking.balance;
            if (amount > 0) {
                subscribedDistributions.add(distributionId);
                // The unclaimed rewards remains the same because the user was not subscribed to the distribution
                userStaking.distributions[distributionId].paidRatePerToken = _updateDistributionRate(distributionId);
                distribution.totalSupply = distribution.totalSupply.add(amount);
                emit Staked(distributionId, msg.sender, amount);
            }
        }
    }

    /**
     * @dev Unsubscribes a user to a list of distributions
     * @param distributionIds List of distributions to unsubscribe
     */
    function unsubscribe(bytes32[] memory distributionIds) external {
        for (uint256 i; i < distributionIds.length; i++) {
            bytes32 distributionId = distributionIds[i];
            Distribution storage distribution = _getDistribution(distributionId);
            require(distribution.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");

            UserStaking storage userStaking = _userStakings[distribution.stakingToken][msg.sender];
            EnumerableSet.Bytes32Set storage subscribedDistributions = userStaking.subscribedDistributions;

            // If the user had tokens staked that applied to this distribution, we need to update their standing before
            // unsubscribing, which is effectively an unstake.
            uint256 amount = userStaking.balance;
            if (amount > 0) {
                _updateUserPaymentRatePerToken(userStaking, distributionId);
            }

            require(subscribedDistributions.remove(distributionId), "DISTRIBUTION_NOT_SUBSCRIBED");

            if (amount > 0) {
                _updateUserPaymentRatePerToken(userStaking, distributionId);
                userStaking.subscribedDistributions.remove(distributionId);
                distribution.totalSupply = distribution.totalSupply.sub(amount);
                emit Withdrawn(distributionId, msg.sender, amount);
            }
        }
    }

    /**
     * @dev Stakes tokens
     * @param stakingToken The token to be staked to earn rewards
     * @param amount Amount of tokens to be staked
     */
    function stake(IERC20 stakingToken, uint256 amount) external nonReentrant {
        _stakeFor(stakingToken, amount, msg.sender, msg.sender);
    }

    /**
     * @notice Stakes tokens on behalf of other user
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
     * @dev Stakes tokens using a permit signature for approval
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
     * @dev Withdraw tokens
     * @param stakingToken The token to be withdrawn
     * @param amount Amount of tokens to be withdrawn
     * @param receiver The recipient of the staked tokens
     */
    function withdraw(
        IERC20 stakingToken,
        uint256 amount,
        address receiver
    ) public nonReentrant updateDistributions(stakingToken, msg.sender) {
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
     * @dev Claims rewards for a list of distributions
     * @param distributionIds List of distributions claiming the rewards of
     */
    function claim(bytes32[] memory distributionIds) external nonReentrant {
        _claim(distributionIds, msg.sender, IVault.UserBalanceOpKind.WITHDRAW_INTERNAL);
    }

    /**
     * @dev Claims rewards for a list of distributions to internal balance
     * @param distributionIds The distributions to claim rewards for
     */
    function claimAsInternalBalance(bytes32[] memory distributionIds) external nonReentrant {
        _claim(distributionIds, msg.sender, IVault.UserBalanceOpKind.TRANSFER_INTERNAL);
    }

    /**
     * @dev Claims rewards for a list of distributions to a callback contract
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
     * @dev Withdraws staking tokens and claims rewards for a list of distributions
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
     * @dev Withdraws staking tokens and claims rewards for a list of distributions to a callback contract
     * @param stakingTokens The staking tokens to withdraw tokens from
     * @param distributionIds The distributions to claim rewards for
     * @param callbackContract The contract where rewards will be transferred
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
    ) internal updateDistributions(stakingToken, user) {
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

        // We hold stakingTokens in an external balance as BPT needs to be external anyway
        // in the case where a user is exiting the pool after unstaking.
        // TODO: consider a TRANSFER_EXTERNAL call
        stakingToken.safeTransferFrom(from, address(this), amount);
    }

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
                _updateUserPaymentRatePerToken(userStaking, distributionId);
            }

            UserDistribution storage userDistribution = userStaking.distributions[distributionId];
            uint256 unclaimedTokens = userDistribution.unclaimedTokens;
            address distributionToken = address(distribution.distributionToken);

            if (unclaimedTokens > 0) {
                userDistribution.unclaimedTokens = 0;
                emit RewardPaid(msg.sender, distributionToken, unclaimedTokens);
            }

            ops[i] = IVault.UserBalanceOp({
                asset: IAsset(distributionToken),
                amount: unclaimedTokens,
                sender: address(this),
                recipient: payable(recipient),
                kind: kind
            });
        }

        getVault().manageUserBalance(ops);
    }

    function _updateDistributions(IERC20 stakingToken, address user) internal {
        UserStaking storage userStaking = _userStakings[stakingToken][user];
        EnumerableSet.Bytes32Set storage distributions = userStaking.subscribedDistributions;
        uint256 distributionsLength = distributions.length();

        for (uint256 i; i < distributionsLength; i++) {
            bytes32 distributionId = distributions.unchecked_at(i);
            _updateUserPaymentRatePerToken(userStaking, distributionId);
        }
    }

    function _updateUserPaymentRatePerToken(UserStaking storage userStaking, bytes32 distributionId) internal {
        uint256 rewardPerTokenStored = _updateDistributionRate(distributionId);
        UserDistribution storage userDistribution = userStaking.distributions[distributionId];
        userDistribution.unclaimedTokens = _totalEarned(userStaking, distributionId);
        userDistribution.paidRatePerToken = rewardPerTokenStored;
    }

    /**
     * @notice Updates the amount of rewards per token staked for a distribution
     * @dev This is expected to be called whenever a user's applicable staked balance changes,
     *      either through adding/removing tokens or subscribing/unsubscribing from the distribution.
     * @param distributionId ID of the distribution being updated
     * @return paymentPerTokenStored The updated number of reward tokens paid per staked token
     */
    function _updateDistributionRate(bytes32 distributionId) internal returns (uint256 paymentPerTokenStored) {
        Distribution storage distribution = _getDistribution(distributionId);
        paymentPerTokenStored = _paymentPerToken(distribution);
        distribution.paymentPerTokenStored = paymentPerTokenStored;
        distribution.lastUpdateTime = _lastTimeRewardApplicable(distribution);
    }

    function _paymentPerToken(Distribution storage distribution) internal view returns (uint256) {
        uint256 supply = distribution.totalSupply;
        if (supply == 0) {
            return distribution.paymentPerTokenStored;
        }

        // Underflow is impossible here because lastTimeRewardApplicable(...) is always greater than last update time
        uint256 unpaidDuration = _lastTimeRewardApplicable(distribution) - distribution.lastUpdateTime;
        uint256 unpaidAmountPerToken = Math.mul(unpaidDuration, distribution.paymentRate).divDown(supply);
        return distribution.paymentPerTokenStored.add(unpaidAmountPerToken);
    }

    function _lastTimeRewardApplicable(Distribution storage distribution) internal view returns (uint256) {
        return Math.min(block.timestamp, distribution.periodFinish);
    }

    /**
     * @dev Returns the total unclaimed tokens for a user for a particular distribution
     * @param userStaking Storage pointer to user's staked position information
     * @param distributionId ID of the distribution being queried
     */
    function _totalEarned(UserStaking storage userStaking, bytes32 distributionId) internal view returns (uint256) {
        uint256 unclaimedTokens = userStaking.distributions[distributionId].unclaimedTokens;
        return _unaccountedEarned(userStaking, distributionId).add(unclaimedTokens);
    }

    /**
     * @dev Returns the tokens earned for a particular distribution between
     *      the last time the user updated their position and now
     * @param userStaking Storage pointer to user's staked position information
     * @param distributionId ID of the distribution being queried
     */
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
        uint256 totalPaymentPerToken = _paymentPerToken(_getDistribution(distributionId)).sub(paidRatePerToken);
        return userStaking.balance.mulDown(totalPaymentPerToken);
    }

    function _getDistribution(
        IERC20 stakingToken,
        IERC20 distributionToken,
        address rewarder
    ) internal view returns (Distribution storage) {
        return _getDistribution(getDistributionId(stakingToken, distributionToken, rewarder));
    }

    function _getDistribution(bytes32 id) internal view returns (Distribution storage) {
        return _distributions[id];
    }
}
