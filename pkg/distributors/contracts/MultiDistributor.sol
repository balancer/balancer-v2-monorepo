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

// solhint-disable not-rely-on-time

/**
 * @title MultiDistributor
 * Based on Curve Finance's MultiRewards contract updated to be compatible with solc 0.7.0:
 * https://github.com/curvefi/multi-rewards/blob/master/contracts/MultiRewards.sol commit #9947623
 */
contract MultiDistributor is IMultiDistributor, ReentrancyGuard, MultiDistributorAuthorization {
    using FixedPoint for uint256;
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /*
     * Distribution accounting explanation:
     *
     * Distributors can start a distribution channel with a set amount of tokens to be distributed over a period,
     * from this a `paymentRate` may be easily calculated.
     *
     * Two pieces of global information are stored for the amount of tokens paid out:
     * `globalTokensPerStake` is the number of tokens claimable from a single staking token staked from the start.
     * `lastUpdateTime` represents the timestamp of the last time `globalTokensPerStake` was updated.
     *
     * `globalTokensPerStake` can be calculated by:
     * 1. Calculating the amount of tokens distributed by multiplying `paymentRate` by the time since `lastUpdateTime`
     * 2. Dividing this by the supply of staked tokens to get payment per staked token
     * The existing `globalTokensPerStake` is then incremented by this amount.
     *
     * Updating these two values locks in the number of tokens that the current stakers can claim.
     * This MUST be done whenever the total supply of staked tokens changes otherwise new stakers
     * will gain a portion of rewards distributed before they staked.
     *
     * Each user tracks their own `userTokensPerStake` which determines how many tokens they can claim.
     * This is done by comparing the global `globalTokensPerStake` with their own `userTokensPerStake`,
     * the difference between these two values times their staked balance is their balance of rewards
     * since `userTokensPerStake` was last updated.
     *
     * This calculation is only correct in the case where the user's staked balance does not change.
     * Therefore before any stake/unstake/subscribe/unsubscribe they must sync their local rate to the global rate.
     * Before `userTokensPerStake` is updated to match `globalTokensPerStake`, the unaccounted rewards
     * which they have earned is stored in `unclaimedTokens` to be claimed later.
     *
     * If staking for the first time `userTokensPerStake` is set to `globalTokensPerStake` with zero `unclaimedTokens`
     * to reflect that the user will only start accumulating tokens from that point on.
     *
     * After performing the above updates, claiming tokens is handled simply by just zeroing out the users
     * `unclaimedTokens` and releasing that amount of tokens to them.
     */

    mapping(bytes32 => DistributionChannel) internal _distributions;
    mapping(IERC20 => mapping(address => UserStaking)) internal _userStakings;

    constructor(IVault vault) Authentication(bytes32(uint256(address(this)))) MultiDistributorAuthorization(vault) {
        // solhint-disable-previous-line no-empty-blocks
        // MultiDistributor is a singleton, so it simply uses its own address to disambiguate action identifiers
    }

    /**
     * @dev Returns the unique identifier used for a distribution channel
     * @param stakingToken The staking token of the distribution channel
     * @param distributionToken The token which is being distributed
     * @param owner The owner of the distribution channel
     */
    function getDistributionChannelId(
        IERC20 stakingToken,
        IERC20 distributionToken,
        address owner
    ) public pure override returns (bytes32) {
        return keccak256(abi.encodePacked(stakingToken, distributionToken, owner));
    }

    /**
     * @dev Returns the information of a distribution channel
     * @param distributionId ID of the distribution channel being queried
     */
    function getDistributionChannel(bytes32 distributionId)
        external
        view
        override
        returns (DistributionChannel memory)
    {
        return _getDistributionChannel(distributionId);
    }

    /**
     * @dev Calculates the payment per token for a distribution channel
     * @param distributionId ID of the distribution channel being queried
     */
    function globalTokensPerStake(bytes32 distributionId) external view override returns (uint256) {
        return _globalTokensPerStake(_getDistributionChannel(distributionId));
    }

    /**
     * @dev Returns the total supply of tokens subscribed to a distribution channel
     * @param distributionId ID of the distribution channel being queried
     */
    function totalSupply(bytes32 distributionId) external view override returns (uint256) {
        return _getDistributionChannel(distributionId).totalSupply;
    }

    /**
     * @dev Returns if a user is subscribed to a distribution channel or not
     * @param distributionId ID of the distribution channel being queried
     * @param user The address of the user being queried
     */
    function isSubscribed(bytes32 distributionId, address user) external view override returns (bool) {
        IERC20 stakingToken = _getDistributionChannel(distributionId).stakingToken;
        return _userStakings[stakingToken][user].subscribedDistributions.contains(distributionId);
    }

    /**
     * @dev Returns the information of a distribution channel for a user
     * @param distributionId ID of the distribution channel being queried
     * @param user Address of the user being queried
     */
    function getUserDistributionInfo(bytes32 distributionId, address user)
        external
        view
        override
        returns (UserDistributionInfo memory)
    {
        IERC20 stakingToken = _getDistributionChannel(distributionId).stakingToken;
        return _userStakings[stakingToken][user].distributionInfo[distributionId];
    }

    /**
     * @dev Returns the total unclaimed payment for a user for a particular distribution channel
     * @param distributionId ID of the distribution channel being queried
     * @param user Address of the user being queried
     */
    function getClaimableTokens(bytes32 distributionId, address user) external view override returns (uint256) {
        DistributionChannel storage distributionChannel = _getDistributionChannel(distributionId);
        UserStaking storage userStaking = _userStakings[distributionChannel.stakingToken][user];
        UserDistributionInfo storage userDistributionInfo = userStaking.distributionInfo[distributionId];

        // If the user isn't subscribed to the queried distribution channel, they don't have any unaccounted for tokens.
        // Then we can just return the stored number of tokens which the user can claim.
        if (!userStaking.subscribedDistributions.contains(distributionId)) {
            return userDistributionInfo.unclaimedTokens;
        }
        return _getUnclaimedTokens(userStaking, userDistributionInfo, _globalTokensPerStake(distributionChannel));
    }

    /**
     * @dev Returns the staked balance of a user for a staking token
     * @param stakingToken The staking token being queried
     * @param user Address of the user being queried
     */
    function balanceOf(IERC20 stakingToken, address user) external view override returns (uint256) {
        return _userStakings[stakingToken][user].balance;
    }

    /**
     * @dev Creates a new distribution channel
     * @param stakingToken The staking token that will be eligible for this distribution channel
     * @param distributionToken The token to be distributed to users
     * @param duration The duration over which each distribution is spread
     */
    function createDistribution(
        IERC20 stakingToken,
        IERC20 distributionToken,
        uint256 duration
    ) external override returns (bytes32 distributionChannelId) {
        require(duration > 0, "DISTRIBUTION_DURATION_ZERO");
        require(address(stakingToken) != address(0), "STAKING_TOKEN_ZERO_ADDRESS");
        require(address(distributionToken) != address(0), "DISTRIBUTION_TOKEN_ZERO_ADDRESS");

        distributionChannelId = getDistributionChannelId(stakingToken, distributionToken, msg.sender);
        DistributionChannel storage distributionChannel = _getDistributionChannel(distributionChannelId);
        require(distributionChannel.duration == 0, "DISTRIBUTION_ALREADY_CREATED");

        distributionChannel.duration = duration;
        distributionChannel.owner = msg.sender;
        distributionChannel.distributionToken = distributionToken;
        distributionChannel.stakingToken = stakingToken;

        emit DistributionCreated(distributionChannelId, stakingToken, distributionToken, msg.sender);
    }

    /**
     * @dev Sets the duration for distributions within a distribution channel.
     * @param distributionChannelId ID of the distribution channel to be modified
     * @param duration Duration over which each distribution is spread
     */
    function setDistributionDuration(bytes32 distributionChannelId, uint256 duration) external override {
        require(duration > 0, "DISTRIBUTION_DURATION_ZERO");

        DistributionChannel storage distributionChannel = _getDistributionChannel(distributionChannelId);
        // These values being guaranteed to be non-zero for created distributions means we can rely on zero as a
        // sentinel value that marks non-existent distributions.
        require(distributionChannel.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");
        require(distributionChannel.owner == msg.sender, "SENDER_NOT_OWNER");
        require(distributionChannel.periodFinish < block.timestamp, "DISTRIBUTION_STILL_ACTIVE");

        distributionChannel.duration = duration;
        emit DistributionDurationSet(distributionChannelId, duration);
    }

    /**
     * @notice Deposits tokens to be distributed to stakers subscribed to distribution channel `distributionId`
     * @dev Starts a new distribution period for `duration` seconds from now.
     *      If the previous period is still active its undistributed tokens are rolled over into the new period.
     * @param distributionChannelId ID of the distribution channel to be funded
     * @param amount The amount of tokens to deposit
     */
    function fundDistribution(bytes32 distributionChannelId, uint256 amount) external override nonReentrant {
        DistributionChannel storage distributionChannel = _getDistributionChannel(distributionChannelId);
        // These values being guaranteed to be non-zero for created distributions means we can rely on zero as a
        // sentinel value that marks non-existent distributions.
        require(distributionChannel.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");
        require(distributionChannel.owner == msg.sender, "SENDER_NOT_OWNER");

        // Before receiving the tokens, we must update the distribution channel's rate
        // as we are about to change its payment rate, which affects all other rates.
        _updateDistributionRate(distributionChannel);

        // Get the tokens and deposit them in the Vault as this contract's internal balance, making claims to internal
        // balance, joining pools, etc., use less gas.
        IERC20 distributionToken = distributionChannel.distributionToken;
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

        uint256 duration = distributionChannel.duration;
        uint256 periodFinish = distributionChannel.periodFinish;

        // The new payment rate will depend on whether or not there's already an ongoing period, in which case the two
        // will be merged. In both scenarios we round down to avoid paying more tokens than were received.
        if (block.timestamp >= periodFinish) {
            // Current distribution period has ended so new period consists only of amount provided.
            distributionChannel.paymentRate = Math.divDown(amount, duration);
        } else {
            // Current distribution period is still in progress.
            // Calculate number of tokens that haven't been distributed yet and apply to the new distribution period.
            // This means that any previously pending tokens will be re-distributed over the extended duration, so if a
            // constant rate is desired new funding should be applied close to the end date of a distribution.

            // Checked arithmetic is not required due to the if
            uint256 remainingTime = periodFinish - block.timestamp;
            uint256 leftoverTokens = Math.mul(remainingTime, distributionChannel.paymentRate);
            distributionChannel.paymentRate = Math.divDown(amount.add(leftoverTokens), duration);
        }

        distributionChannel.lastUpdateTime = block.timestamp;
        distributionChannel.periodFinish = block.timestamp.add(duration);
        emit DistributionFunded(distributionChannelId, amount);
    }

    /**
     * @dev Subscribes a user to a list of distribution channels
     * @param distributionChannelIds List of distribution channels to subscribe
     */
    function subscribeDistributions(bytes32[] memory distributionChannelIds) external override {
        for (uint256 i; i < distributionChannelIds.length; i++) {
            bytes32 distributionChannelId = distributionChannelIds[i];
            DistributionChannel storage distributionChannel = _getDistributionChannel(distributionChannelId);
            require(distributionChannel.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");

            IERC20 stakingToken = distributionChannel.stakingToken;
            UserStaking storage userStaking = _userStakings[stakingToken][msg.sender];
            EnumerableSet.Bytes32Set storage subscribedDistributions = userStaking.subscribedDistributions;
            require(subscribedDistributions.add(distributionChannelId), "ALREADY_SUBSCRIBED_DISTRIBUTION");

            uint256 amount = userStaking.balance;
            if (amount > 0) {
                // If subscribing to a distribution channel that uses a staking token for which the user
                // has already staked, those tokens then immediately become part of the channel's staked tokens
                // (i.e. the user is staking for the new distribution channel).
                // This means we need to update the distribution rate, as we are about to change its total
                // staked tokens and decrease the global per token rate.
                // The unclaimed tokens remain unchanged as the user was not subscribed to the channel
                // and therefore not eligible to receive any unaccounted-for tokens.
                userStaking.distributionInfo[distributionChannelId].userTokensPerStake = _updateDistributionRate(
                    distributionChannel
                );
                distributionChannel.totalSupply = distributionChannel.totalSupply.add(amount);
                emit Staked(distributionChannelId, msg.sender, amount);
            }
        }
    }

    /**
     * @dev Unsubscribes a user to a list of distribution channels
     * @param distributionChannelIds List of distribution channels to unsubscribe
     */
    function unsubscribeDistributions(bytes32[] memory distributionChannelIds) external override {
        for (uint256 i; i < distributionChannelIds.length; i++) {
            bytes32 distributionChannelId = distributionChannelIds[i];
            DistributionChannel storage distributionChannel = _getDistributionChannel(distributionChannelId);
            require(distributionChannel.duration > 0, "DISTRIBUTION_DOES_NOT_EXIST");

            UserStaking storage userStaking = _userStakings[distributionChannel.stakingToken][msg.sender];
            EnumerableSet.Bytes32Set storage subscribedDistributions = userStaking.subscribedDistributions;

            // If the user had tokens staked that applied to this distribution channel, we need to update
            // their standing before unsubscribing, which is effectively an unstake.
            uint256 amount = userStaking.balance;
            if (amount > 0) {
                _updateUserTokensPerStake(
                    distributionChannel,
                    userStaking,
                    userStaking.distributionInfo[distributionChannelId]
                );
                distributionChannel.totalSupply = distributionChannel.totalSupply.sub(amount);
                emit Unstaked(distributionChannelId, msg.sender, amount);
            }

            require(subscribedDistributions.remove(distributionChannelId), "DISTRIBUTION_NOT_SUBSCRIBED");
        }
    }

    /**
     * @dev Stakes tokens
     * @param stakingToken The token to be staked to be eligible for distributions
     * @param amount Amount of tokens to be staked
     */
    function stake(
        IERC20 stakingToken,
        uint256 amount,
        address sender,
        address recipient
    ) external override nonReentrant {
        require(sender == msg.sender, "INVALID_SENDER"); // TODO: let relayers pass an alternative sender
        _stake(stakingToken, amount, sender, recipient, false);
    }

    /**
     * @dev Stakes tokens using the user's token approval on the vault
     * @param stakingToken The token to be staked to be eligible for distributions
     * @param amount Amount of tokens to be staked
     * @param sender The address which provides tokens to stake
     * @param recipient The address which receives the staked tokens
     */
    function stakeUsingVault(
        IERC20 stakingToken,
        uint256 amount,
        address sender,
        address recipient
    ) external override nonReentrant {
        require(sender == msg.sender, "INVALID_SENDER"); // TODO: let relayers pass an alternative sender
        _stake(stakingToken, amount, sender, recipient, true);
    }

    /**
     * @dev Stakes tokens using a permit signature for approval
     * @param stakingToken The token to be staked to be eligible for distributions
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
    ) external override nonReentrant {
        IERC20Permit(address(stakingToken)).permit(user, address(this), amount, deadline, v, r, s);
        _stake(stakingToken, amount, user, user, false);
    }

    /**
     * @dev Unstake tokens
     * @param stakingToken The token to be unstaked
     * @param amount Amount of tokens to be unstaked
     * @param sender The address which is unstaking its tokens
     * @param recipient The address which receives the unstaked tokens
     */
    function unstake(
        IERC20 stakingToken,
        uint256 amount,
        address sender,
        address recipient
    ) external override nonReentrant {
        require(sender == msg.sender, "INVALID_SENDER"); // TODO: let relayers pass an alternative sender
        _unstake(stakingToken, amount, sender, recipient);
    }

    /**
     * @dev Claims earned distribution tokens for a list of distribution channels
     * @param distributionChannelIds List of distribution channels to claim
     * @param toInternalBalance Whether to send the claimed tokens to the recipient's internal balance
     * @param sender The address which earned the tokens being claimed
     * @param recipient The address which receives the claimed tokens
     */
    function claim(
        bytes32[] memory distributionChannelIds,
        bool toInternalBalance,
        address sender,
        address recipient
    ) external override nonReentrant {
        require(sender == msg.sender, "INVALID_SENDER"); // TODO: let relayers pass an alternative sender
        _claim(
            distributionChannelIds,
            toInternalBalance ? IVault.UserBalanceOpKind.TRANSFER_INTERNAL : IVault.UserBalanceOpKind.WITHDRAW_INTERNAL,
            sender,
            recipient
        );
    }

    /**
     * @dev Claims earned tokens for a list of distribution channels to a callback contract
     * @param distributionChannelIds List of distribution channels to claim
     * @param sender The address which earned the tokens being claimed
     * @param callbackContract The contract where tokens will be transferred
     * @param callbackData The data that is used to call the callback contract's 'callback' method
     */
    function claimWithCallback(
        bytes32[] memory distributionChannelIds,
        address sender,
        IDistributorCallback callbackContract,
        bytes memory callbackData
    ) external override nonReentrant {
        require(sender == msg.sender, "INVALID_SENDER"); // TODO: let relayers pass an alternative sender
        _claim(distributionChannelIds, IVault.UserBalanceOpKind.TRANSFER_INTERNAL, sender, address(callbackContract));
        callbackContract.distributorCallback(callbackData);
    }

    /**
     * @dev Withdraws staking tokens and claims for a list of distribution channels
     * @param stakingTokens The staking tokens to withdraw tokens from
     * @param distributionChannelIds The distribution channels to claim for
     */
    function exit(IERC20[] memory stakingTokens, bytes32[] memory distributionChannelIds)
        external
        override
        nonReentrant
    {
        for (uint256 i; i < stakingTokens.length; i++) {
            IERC20 stakingToken = stakingTokens[i];
            UserStaking storage userStaking = _userStakings[stakingToken][msg.sender];
            _unstake(stakingToken, userStaking.balance, msg.sender, msg.sender);
        }

        _claim(distributionChannelIds, IVault.UserBalanceOpKind.WITHDRAW_INTERNAL, msg.sender, msg.sender);
    }

    /**
     * @dev Withdraws staking tokens and claims for a list of distribution channels to a callback contract
     * @param stakingTokens The staking tokens to withdraw tokens from
     * @param distributionChannelIds The distribution channels to claim for
     * @param callbackContract The contract where tokens will be transferred
     * @param callbackData The data that is used to call the callback contract's 'callback' method
     */
    function exitWithCallback(
        IERC20[] memory stakingTokens,
        bytes32[] memory distributionChannelIds,
        IDistributorCallback callbackContract,
        bytes memory callbackData
    ) external override nonReentrant {
        for (uint256 i; i < stakingTokens.length; i++) {
            IERC20 stakingToken = stakingTokens[i];
            UserStaking storage userStaking = _userStakings[stakingToken][msg.sender];
            _unstake(stakingToken, userStaking.balance, msg.sender, msg.sender);
        }

        _claim(
            distributionChannelIds,
            IVault.UserBalanceOpKind.TRANSFER_INTERNAL,
            msg.sender,
            address(callbackContract)
        );
        callbackContract.distributorCallback(callbackData);
    }

    function _stake(
        IERC20 stakingToken,
        uint256 amount,
        address sender,
        address recipient,
        bool useVaultApproval
    ) internal {
        require(amount > 0, "STAKE_AMOUNT_ZERO");

        UserStaking storage userStaking = _userStakings[stakingToken][recipient];

        // Before we increase the recipient's staked balance we need to update all of their subscriptions
        _updateSubscribedDistributions(userStaking);

        userStaking.balance = userStaking.balance.add(amount);

        EnumerableSet.Bytes32Set storage subscribedChannelIds = userStaking.subscribedDistributions;
        uint256 subscriptionsLength = subscribedChannelIds.length();

        // We also need to update all distribution channels the recipient is subscribed to,
        // adding the staked tokens to their totals.
        for (uint256 i; i < subscriptionsLength; i++) {
            bytes32 distributionChannelId = subscribedChannelIds.unchecked_at(i);
            DistributionChannel storage distributionChannel = _getDistributionChannel(distributionChannelId);
            distributionChannel.totalSupply = distributionChannel.totalSupply.add(amount);
            emit Staked(distributionChannelId, recipient, amount);
        }

        // We hold stakingTokens in an external balance as BPT needs to be external anyway
        // in the case where a user is exiting the pool after unstaking.
        if (useVaultApproval) {
            IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);
            ops[0] = IVault.UserBalanceOp({
                asset: IAsset(address(stakingToken)),
                amount: amount,
                sender: sender,
                recipient: payable(address(this)),
                kind: IVault.UserBalanceOpKind.TRANSFER_EXTERNAL
            });
            getVault().manageUserBalance(ops);
        } else {
            stakingToken.safeTransferFrom(sender, address(this), amount);
        }
    }

    function _unstake(
        IERC20 stakingToken,
        uint256 amount,
        address sender,
        address recipient
    ) internal {
        require(amount > 0, "UNSTAKE_AMOUNT_ZERO");

        UserStaking storage userStaking = _userStakings[stakingToken][sender];

        // Before we reduce the sender's staked balance we need to update all of their subscriptions
        _updateSubscribedDistributions(userStaking);

        uint256 currentBalance = userStaking.balance;
        require(currentBalance >= amount, "UNSTAKE_AMOUNT_UNAVAILABLE");
        userStaking.balance = currentBalance - amount;

        EnumerableSet.Bytes32Set storage subscribedChannelIds = userStaking.subscribedDistributions;
        uint256 subscriptionsLength = subscribedChannelIds.length();

        // We also need to update all distribution channels the sender was subscribed to,
        // deducting the unstaked tokens from their totals.
        for (uint256 i; i < subscriptionsLength; i++) {
            bytes32 distributionChannelId = subscribedChannelIds.unchecked_at(i);
            DistributionChannel storage distributionChannel = _getDistributionChannel(distributionChannelId);
            distributionChannel.totalSupply = distributionChannel.totalSupply.sub(amount);
            emit Unstaked(distributionChannelId, sender, amount);
        }

        stakingToken.safeTransfer(recipient, amount);
    }

    function _claim(
        bytes32[] memory distributionIds,
        IVault.UserBalanceOpKind kind,
        address sender,
        address recipient
    ) internal {
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](distributionIds.length);

        for (uint256 i; i < distributionIds.length; i++) {
            bytes32 distributionChannelId = distributionIds[i];
            DistributionChannel storage distributionChannel = _getDistributionChannel(distributionChannelId);
            UserStaking storage userStaking = _userStakings[distributionChannel.stakingToken][sender];
            UserDistributionInfo storage userDistributionInfo = userStaking.distributionInfo[distributionChannelId];

            // Note that the user may have unsubscribed from the distribution but still be due tokens. We therefore only
            // update the distribution if the user is subscribed to it (otherwise, it is already up to date).
            if (userStaking.subscribedDistributions.contains(distributionChannelId)) {
                _updateUserTokensPerStake(distributionChannel, userStaking, userDistributionInfo);
            }

            uint256 unclaimedTokens = userDistributionInfo.unclaimedTokens;
            address distributionToken = address(distributionChannel.distributionToken);

            if (unclaimedTokens > 0) {
                userDistributionInfo.unclaimedTokens = 0;
                emit TokensClaimed(sender, distributionToken, unclaimedTokens);
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

    /**
     * @dev Updates the payment rate for all the distribution channels that a user has signed up for a staking token
     */
    function _updateSubscribedDistributions(UserStaking storage userStaking) internal {
        EnumerableSet.Bytes32Set storage subscribedChannelIds = userStaking.subscribedDistributions;
        uint256 subscriptionsLength = subscribedChannelIds.length();

        for (uint256 i; i < subscriptionsLength; i++) {
            bytes32 distributionChannelId = subscribedChannelIds.unchecked_at(i);
            _updateUserTokensPerStake(
                _getDistributionChannel(distributionChannelId),
                userStaking,
                userStaking.distributionInfo[distributionChannelId]
            );
        }
    }

    function _updateUserTokensPerStake(
        DistributionChannel storage distributionChannel,
        UserStaking storage userStaking,
        UserDistributionInfo storage userDistribution
    ) internal {
        uint256 updatedGlobalTokensPerStake = _updateDistributionRate(distributionChannel);
        userDistribution.unclaimedTokens = _getUnclaimedTokens(
            userStaking,
            userDistribution,
            updatedGlobalTokensPerStake
        );
        userDistribution.userTokensPerStake = updatedGlobalTokensPerStake;
    }

    /**
     * @notice Updates the amount of distribution tokens paid per token staked for a distribution channel
     * @dev This is expected to be called whenever a user's applicable staked balance changes,
     *      either through adding/removing tokens or subscribing/unsubscribing from the distribution channel.
     * @param distributionChannel The distribution channel being updated
     * @return updatedGlobalTokensPerStake The updated number of distribution tokens paid per staked token
     */
    function _updateDistributionRate(DistributionChannel storage distributionChannel)
        internal
        returns (uint256 updatedGlobalTokensPerStake)
    {
        updatedGlobalTokensPerStake = _globalTokensPerStake(distributionChannel);
        distributionChannel.globalTokensPerStake = updatedGlobalTokensPerStake;
        distributionChannel.lastUpdateTime = _lastTimePaymentApplicable(distributionChannel);
    }

    function _globalTokensPerStake(DistributionChannel storage distributionChannel) internal view returns (uint256) {
        uint256 supply = distributionChannel.totalSupply;
        if (supply == 0) {
            return distributionChannel.globalTokensPerStake;
        }

        // Underflow is impossible here because _lastTimePaymentApplicable(...) is always greater than last update time
        uint256 unpaidDuration = _lastTimePaymentApplicable(distributionChannel) - distributionChannel.lastUpdateTime;
        uint256 unpaidAmountPerToken = Math.mul(unpaidDuration, distributionChannel.paymentRate).divDown(supply);
        return distributionChannel.globalTokensPerStake.add(unpaidAmountPerToken);
    }

    /**
     * @dev Returns the timestamp up to which a distribution channel has been distributing tokens
     * @param distribution The distribution channel being queried
     */
    function _lastTimePaymentApplicable(DistributionChannel storage distribution) internal view returns (uint256) {
        return Math.min(block.timestamp, distribution.periodFinish);
    }

    /**
     * @notice Returns the total unclaimed tokens for a user for a particular distribution channel
     * @dev Only returns correct results when the user is subscribed to the distribution channel
     * @param userStaking Storage pointer to user's staked position information
     * @param userDistribution Storage pointer to user specific information on distribution channel
     * @param updatedGlobalTokensPerStake The updated number of distribution tokens paid per staked token
     */
    function _getUnclaimedTokens(
        UserStaking storage userStaking,
        UserDistributionInfo storage userDistribution,
        uint256 updatedGlobalTokensPerStake
    ) internal view returns (uint256) {
        uint256 unclaimedTokens = userDistribution.unclaimedTokens;
        return
            _unaccountedUnclaimedTokens(userStaking, userDistribution, updatedGlobalTokensPerStake).add(
                unclaimedTokens
            );
    }

    /**
     * @notice Returns the tokens earned for a particular distribution channel between
     *         the last time the user updated their position and now
     * @dev Only returns correct results when the user is subscribed to the distribution channel
     * @param userStaking Storage pointer to user's staked position information
     * @param userDistributionInfo Storage pointer to user specific information on distribution channel
     * @param updatedGlobalTokensPerStake The updated number of distribution tokens paid per staked token
     */
    function _unaccountedUnclaimedTokens(
        UserStaking storage userStaking,
        UserDistributionInfo storage userDistributionInfo,
        uint256 updatedGlobalTokensPerStake
    ) internal view returns (uint256) {
        uint256 unaccountedTokensPerStake = updatedGlobalTokensPerStake.sub(userDistributionInfo.userTokensPerStake);
        return userStaking.balance.mulDown(unaccountedTokensPerStake);
    }

    function _getDistributionChannel(
        IERC20 stakingToken,
        IERC20 distributionToken,
        address owner
    ) internal view returns (DistributionChannel storage) {
        return _getDistributionChannel(getDistributionChannelId(stakingToken, distributionToken, owner));
    }

    function _getDistributionChannel(bytes32 id) internal view returns (DistributionChannel storage) {
        return _distributions[id];
    }
}
