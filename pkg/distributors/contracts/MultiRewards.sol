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
import "./MultiRewardsAuthorization.sol";

import "./interfaces/IMultiRewards.sol";
import "./interfaces/IDistributorCallback.sol";
import "./interfaces/IDistributor.sol";

// solhint-disable not-rely-on-time

/**
 * Balancer MultiRewards claim contract (claim to internal balance) based on
 * Curve Finance's MultiRewards contract, updated to be compatible with solc 0.7.0
 * https://github.com/curvefi/multi-rewards/blob/master/contracts/MultiRewards.sol commit #9947623
 */

contract MultiRewards is IMultiRewards, IDistributor, ReentrancyGuard, MultiRewardsAuthorization {
    using FixedPoint for uint256;
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    /* ========== STATE VARIABLES ========== */

    struct User {
        uint256 balance;
        mapping(IERC20 => uint256) unpaidRewards; // rewards token => balance
        mapping(IERC20 => mapping(address => uint256)) paidRewards; // rewards token => rewarder => balance
    }

    struct Reward {
        uint256 duration;
        uint256 periodFinish;
        uint256 rewardRate;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
    }

    struct RewardsToken {
        mapping(address => Reward) rewards; // rewarder => reward
        EnumerableSet.AddressSet whitelistedRewarders;
    }

    struct StakingToken {
        uint256 totalSupply;
        mapping(address => User) users;
        mapping(IERC20 => RewardsToken) rewardsTokens;
        EnumerableSet.AddressSet whitelistedRewardsTokens;
    }

    RewardsScheduler public immutable rewardsScheduler;

    // solhint-disable-next-line private-vars-leading-underscore
    mapping(IERC20 => StakingToken) internal stakingTokens;

    /* ========== CONSTRUCTOR ========== */

    constructor(IVault _vault)
        // MultiRewards is a singleton, so it simply uses its own address to disambiguate action identifiers
        Authentication(bytes32(uint256(address(this))))
        MultiRewardsAuthorization(_vault)
    {
        // solhint-disable-previous-line no-empty-blocks
        rewardsScheduler = new RewardsScheduler();
    }

    /**
     * @notice Allows a rewarder to be explicitly added to a whitelist of rewarders
     * @param _stakingToken The token that the rewarder can reward for
     * @param _rewardsToken The token to be distributed to stakers
     * @param _rewarder The address of the rewarder
     */
    function whitelistRewarder(
        IERC20 _stakingToken,
        IERC20 _rewardsToken,
        address _rewarder
    ) external override onlyWhitelisted(_stakingToken) {
        _whitelistRewarder(_stakingToken, _rewardsToken, _rewarder);
    }

    /**
     * @notice Whether a rewarder can reward a staking token with a reward token
     * @param _stakingToken The token that the rewarder can reward for
     * @param _rewardsToken The token to be distributed to stakers
     * @param _rewarder The address of the rewarder
     */
    function isWhitelistedRewarder(
        IERC20 _stakingToken,
        IERC20 _rewardsToken,
        address _rewarder
    ) public view override returns (bool) {
        return _isWhitelistedRewarder(_stakingToken, _rewardsToken, _rewarder);
    }

    /**
     * @notice Adds a new reward token to be distributed
     * @param _stakingToken The staking token that will receive rewards
     * @param _rewardsToken The new token to be distributed to stakers
     * @param _rewardsDuration The duration over which each distribution is spread
     */
    function addReward(
        IERC20 _stakingToken,
        IERC20 _rewardsToken,
        uint256 _rewardsDuration
    ) external override onlyWhitelistedRewarder(_stakingToken, _rewardsToken) {
        require(_rewardsDuration > 0, "reward rate must be nonzero");

        StakingToken storage stakingToken = stakingTokens[_stakingToken];
        RewardsToken storage rewardsToken = stakingToken.rewardsTokens[_rewardsToken];
        Reward storage reward = rewardsToken.rewards[msg.sender];
        require(reward.duration == 0, "Duplicate rewards token");

        reward.duration = _rewardsDuration;
        rewardsToken.whitelistedRewarders.add(msg.sender);
        stakingToken.whitelistedRewardsTokens.add(address(_rewardsToken));

        _rewardsToken.approve(address(getVault()), type(uint256).max);
    }

    /* ========== VIEWS ========== */

    /**
     * @dev Tells the total supply for a staking token
     * @param _stakingToken The staking token being queried
     */
    function totalSupply(IERC20 _stakingToken) external view returns (uint256) {
        return stakingTokens[_stakingToken].totalSupply;
    }

    /**
     * @dev Tells the staked balance of a user for a staking token
     * @param _stakingToken The staking token being queried
     * @param _user The address of the user with staked balance
     */
    function balanceOf(IERC20 _stakingToken, address _user) external view returns (uint256) {
        return stakingTokens[_stakingToken].users[_user].balance;
    }

    /**
     * @notice This time is used when determining up until what time a reward has been accounted for
     * @param _stakingToken The staking token being queried
     * @param _rewardsToken The token to be distributed to stakers
     * @param _rewarder The address of the rewarder
     */
    function lastTimeRewardApplicable(
        IERC20 _stakingToken,
        IERC20 _rewardsToken,
        address _rewarder
    ) public view returns (uint256) {
        Reward storage reward = stakingTokens[_stakingToken].rewardsTokens[_rewardsToken].rewards[_rewarder];
        return _lastTimeRewardApplicable(reward);
    }

    function _lastTimeRewardApplicable(Reward storage reward) private view returns (uint256) {
        return Math.min(block.timestamp, reward.periodFinish);
    }

    /**
     * @notice Calculates the amount of reward token per staked tokens
     * @param _stakingToken The staking token being queried
     * @param _rewardsToken The token to be distributed to users
     * @param _rewarder The address of the rewarder
     */
    function rewardPerToken(
        IERC20 _stakingToken,
        IERC20 _rewardsToken,
        address _rewarder
    ) public view returns (uint256) {
        StakingToken storage stakingToken = stakingTokens[_stakingToken];
        Reward storage reward = stakingToken.rewardsTokens[_rewardsToken].rewards[_rewarder];
        return _rewardPerToken(stakingToken, reward);
    }

    function _rewardPerToken(StakingToken storage stakingToken, Reward storage reward) private view returns (uint256) {
        uint256 supply = stakingToken.totalSupply;
        if (supply == 0) {
            return reward.rewardPerTokenStored;
        }

        // Underflow is impossible here because lastTimeRewardApplicable(...) is always greater than last update time
        uint256 unrewardedDuration = _lastTimeRewardApplicable(reward) - reward.lastUpdateTime;
        return reward.rewardPerTokenStored.add(Math.mul(unrewardedDuration, reward.rewardRate).divDown(supply));
    }

    /**
     * @notice Calculates the amount of `_rewardsToken` that `_user` is able to claim from a particular rewarder
     * @param _stakingToken The staking token being queried
     * @param _rewardsToken The token to be distributed to users
     * @param _rewarder The address of the rewarder
     * @param _user The address receiving the rewards
     */
    function unaccountedForUnpaidRewards(
        IERC20 _stakingToken,
        IERC20 _rewardsToken,
        address _rewarder,
        address _user
    ) public view returns (uint256) {
        StakingToken storage stakingToken = stakingTokens[_stakingToken];
        Reward storage reward = stakingToken.rewardsTokens[_rewardsToken].rewards[_rewarder];
        return _unaccountedForUnpaidRewards(stakingToken, _rewardsToken, _rewarder, _user, reward);
    }

    function _unaccountedForUnpaidRewards(
        StakingToken storage stakingToken,
        IERC20 _rewardsToken,
        address _rewarder,
        address _user,
        Reward storage reward
    ) private view returns (uint256) {
        User storage user = stakingToken.users[_user];
        uint256 paidRewards = user.paidRewards[_rewardsToken][_rewarder];
        return user.balance.mulDown(_rewardPerToken(stakingToken, reward).sub(paidRewards));
    }

    /**
     * @notice Calculates the total amount of `rewardsToken` that `account` is able to claim
     * @param _stakingToken The staking token being queried
     * @param _rewardsToken The token to be distributed to stakers
     * @param _user The address receiving the rewards
     */
    function totalEarned(
        IERC20 _stakingToken,
        IERC20 _rewardsToken,
        address _user
    ) public view returns (uint256 total) {
        StakingToken storage stakingToken = stakingTokens[_stakingToken];
        RewardsToken storage rewardsToken = stakingToken.rewardsTokens[_rewardsToken];
        EnumerableSet.AddressSet storage whitelistedRewarders = rewardsToken.whitelistedRewarders;
        uint256 rewardersLength = whitelistedRewarders.length();

        for (uint256 i; i < rewardersLength; i++) {
            address rewarder = whitelistedRewarders.unchecked_at(i);
            Reward storage reward = rewardsToken.rewards[rewarder];
            total = total.add(_unaccountedForUnpaidRewards(stakingToken, _rewardsToken, rewarder, _user, reward));
        }

        total = total.add(stakingToken.users[_user].unpaidRewards[_rewardsToken]);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */
    /**
     * @notice Stakes a token on the msg.sender's behalf
     * @param _stakingToken The token to be staked to earn rewards
     * @param _amount Amount of tokens to be staked
     */
    function stake(IERC20 _stakingToken, uint256 _amount) external nonReentrant {
        _stakeFor(_stakingToken, _amount, msg.sender, msg.sender);
    }

    /**
     * @notice Stakes a token so that `_user` can earn rewards
     * @param _stakingToken The token to be staked to earn rewards
     * @param _amount Amount of tokens to be staked
     * @param _user The user staking on behalf of
     */
    function stakeFor(
        IERC20 _stakingToken,
        uint256 _amount,
        address _user
    ) external nonReentrant {
        _stakeFor(_stakingToken, _amount, _user, msg.sender);
    }

    function _stakeFor(
        IERC20 _stakingToken,
        uint256 _amount,
        address _user,
        address _from
    ) internal updateReward(_stakingToken, _user) {
        require(_amount > 0, "Cannot stake 0");

        StakingToken storage stakingToken = stakingTokens[_stakingToken];
        stakingToken.totalSupply = stakingToken.totalSupply.add(_amount);
        User storage user = stakingToken.users[_user];
        user.balance = user.balance.add(_amount);

        _stakingToken.safeTransferFrom(_from, address(this), _amount);
        emit Staked(address(_stakingToken), _user, _amount);
    }

    /**
     * @notice Stake tokens using a permit signature for approval
     * @param _stakingToken The token to be staked to earn rewards
     * @param _user User staking tokens for
     * @param _amount Amount of tokens to be staked
     * @param _deadline The time at which this expires (unix time)
     * @param _v V of the signature
     * @param _r R of the signature
     * @param _s S of the signature
     */
    function stakeWithPermit(
        IERC20 _stakingToken,
        uint256 _amount,
        address _user,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external nonReentrant {
        IERC20Permit(address(_stakingToken)).permit(_user, address(this), _amount, _deadline, _v, _r, _s);
        _stakeFor(_stakingToken, _amount, _user, _user);
    }

    /**
     * @notice Untakes tokens
     * @param _stakingToken The token to be unstaked
     * @param _amount Amount of tokens to be unstaked
     * @param _receiver The recipient of the staked tokens
     */
    function unstake(
        IERC20 _stakingToken,
        uint256 _amount,
        address _receiver
    ) public nonReentrant updateReward(_stakingToken, msg.sender) {
        require(_amount > 0, "Cannot withdraw 0");

        StakingToken storage stakingToken = stakingTokens[_stakingToken];
        stakingToken.totalSupply = stakingToken.totalSupply.sub(_amount);
        User storage user = stakingToken.users[msg.sender];
        user.balance = user.balance.sub(_amount);

        _stakingToken.safeTransfer(_receiver, _amount);
        emit Withdrawn(address(_stakingToken), msg.sender, _amount);
    }

    /**
     * @notice Allows a user to claim any rewards to an EOA
     * @param _stakingTokens The staking tokens to claim rewards for
     */
    function getReward(IERC20[] memory _stakingTokens) external nonReentrant {
        _getReward(_stakingTokens, msg.sender, IVault.UserBalanceOpKind.WITHDRAW_INTERNAL);
    }

    /**
     * @notice Allows a user to claim any rewards to an internal balance
     * @param _stakingTokens The staking tokens to claim rewards for
     */
    function getRewardAsInternalBalance(IERC20[] memory _stakingTokens) external nonReentrant {
        _getReward(_stakingTokens, msg.sender, IVault.UserBalanceOpKind.TRANSFER_INTERNAL);
    }

    function _rewardOpsCount(IERC20[] memory _stakingTokens) internal view returns (uint256 opsCount) {
        for (uint256 i; i < _stakingTokens.length; i++) {
            opsCount += stakingTokens[_stakingTokens[i]].whitelistedRewardsTokens.length();
        }
    }

    /**
     * @notice Allows a user to claim any rewards to an internal balance or EOA
     */
    function _getReward(
        IERC20[] memory _stakingTokens,
        address _recipient,
        IVault.UserBalanceOpKind _kind
    ) internal {
        uint256 opsIndex;
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](_rewardOpsCount(_stakingTokens));

        for (uint256 i; i < _stakingTokens.length; i++) {
            IERC20 _stakingToken = _stakingTokens[i];
            StakingToken storage stakingToken = stakingTokens[_stakingToken];
            EnumerableSet.AddressSet storage rewardsTokens = stakingToken.whitelistedRewardsTokens;
            uint256 rewardsTokensLength = rewardsTokens.length();

            for (uint256 j; j < rewardsTokensLength; j++) {
                IERC20 _rewardsToken = IERC20(rewardsTokens.unchecked_at(j));
                _updateReward(stakingToken, _rewardsToken, msg.sender);
                User storage user = stakingToken.users[msg.sender];
                uint256 unpaidRewards = user.unpaidRewards[_rewardsToken];

                if (unpaidRewards > 0) {
                    user.unpaidRewards[_rewardsToken] = 0;
                    emit RewardPaid(msg.sender, address(_rewardsToken), unpaidRewards);
                }

                ops[opsIndex++] = IVault.UserBalanceOp({
                    asset: IAsset(address(_rewardsToken)),
                    amount: unpaidRewards,
                    sender: address(this),
                    recipient: payable(_recipient),
                    kind: _kind
                });
            }
        }

        getVault().manageUserBalance(ops);
    }

    /**
     * @notice Allows the user to claim rewards to a callback contract
     * @param _stakingTokens An array of staking tokens from which rewards will be claimed
     * @param _callbackContract The contract where rewards will be transferred
     * @param _callbackData The data that is used to call the callback contract's 'callback' method
     */
    function getRewardWithCallback(
        IERC20[] memory _stakingTokens,
        IDistributorCallback _callbackContract,
        bytes memory _callbackData
    ) external nonReentrant {
        _getReward(_stakingTokens, address(_callbackContract), IVault.UserBalanceOpKind.TRANSFER_INTERNAL);
        _callbackContract.distributorCallback(_callbackData);
    }

    /**
     * @notice Allows a user to unstake all their tokens
     * @param _stakingTokens The staking tokens to unstake tokens for
     */
    function exit(IERC20[] memory _stakingTokens) external {
        for (uint256 i; i < _stakingTokens.length; i++) {
            IERC20 _stakingToken = _stakingTokens[i];
            User storage user = stakingTokens[_stakingToken].users[msg.sender];
            unstake(_stakingToken, user.balance, msg.sender);
        }

        _getReward(_stakingTokens, msg.sender, IVault.UserBalanceOpKind.WITHDRAW_INTERNAL);
    }

    /**
     * @notice Allows a user to unstake transferring rewards to the user and the unstaked tokens to a callback contract
     * @param _stakingTokens The staking tokens to claim rewards for
     * @param _callbackContract The contract where the staked tokens will be transferred
     * @param _callbackData The data that is used to call the callback contract's 'callback' method
     */
    function exitWithCallback(
        IERC20[] memory _stakingTokens,
        IDistributorCallback _callbackContract,
        bytes memory _callbackData
    ) external {
        for (uint256 i; i < _stakingTokens.length; i++) {
            IERC20 _stakingToken = _stakingTokens[i];
            User storage user = stakingTokens[_stakingToken].users[msg.sender];
            unstake(_stakingToken, user.balance, address(_callbackContract));
        }

        _getReward(_stakingTokens, msg.sender, IVault.UserBalanceOpKind.WITHDRAW_INTERNAL);
        _callbackContract.distributorCallback(_callbackData);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /**
     * @notice Allows a rewards distributor, or the reward scheduler to deposit more tokens to be distributed as rewards
     * @param _stakingToken The staking token being rewarded
     * @param _rewardsToken The token to deposit into staking contract for distribution
     * @param _rewarder The address issuing the reward (usually msg.sender)
     * @param _amount The amount of tokens to deposit
     */
    function notifyRewardAmount(
        IERC20 _stakingToken,
        IERC20 _rewardsToken,
        address _rewarder,
        uint256 _amount
    ) external override updateReward(_stakingToken, address(0)) {
        require(
            msg.sender == _rewarder || msg.sender == address(rewardsScheduler),
            "Rewarder must be sender, or rewards scheduler"
        );

        RewardsToken storage rewardsToken = stakingTokens[_stakingToken].rewardsTokens[_rewardsToken];
        require(rewardsToken.whitelistedRewarders.contains(_rewarder), "Reward must be configured with addReward");

        // Handle the transfer of reward tokens via `safeTransferFrom` to reduce the number
        // of transactions required and ensure correctness of the reward amount
        // Tokens always come from msg.sender because either `msg.sender == rewarder`
        // or the`rewardsScheduler` is holding tokens on behalf of the `rewarder`
        _rewardsToken.safeTransferFrom(msg.sender, address(this), _amount);

        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);
        ops[0] = IVault.UserBalanceOp({
            asset: IAsset(address(_rewardsToken)),
            amount: _amount,
            sender: address(this),
            recipient: payable(address(this)),
            kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
        });

        getVault().manageUserBalance(ops);

        Reward storage reward = rewardsToken.rewards[_rewarder];
        uint256 periodFinish = reward.periodFinish;
        uint256 rewardDuration = reward.duration;

        if (block.timestamp >= periodFinish) {
            reward.rewardRate = Math.divDown(_amount, rewardDuration);
        } else {
            // Checked arithmetic is not required due to the if
            uint256 remainingTime = periodFinish - block.timestamp;
            uint256 leftoverRewards = Math.mul(remainingTime, reward.rewardRate);
            reward.rewardRate = Math.divDown(_amount.add(leftoverRewards), rewardDuration);
        }

        reward.lastUpdateTime = block.timestamp;
        reward.periodFinish = block.timestamp.add(rewardDuration);
        emit RewardAdded(address(_stakingToken), address(_rewardsToken), _rewarder, _amount);
    }

    /**
     * @notice Set the reward duration for a reward
     * @param _stakingToken The staking token to be set
     * @param _rewardsToken The token for the reward
     * @param _duration The duration over which each distribution is spread
     */
    function setRewardsDuration(
        IERC20 _stakingToken,
        IERC20 _rewardsToken,
        uint256 _duration
    ) external onlyWhitelistedRewarder(_stakingToken, _rewardsToken) {
        require(_duration > 0, "Reward duration must be non-zero");

        StakingToken storage stakingToken = stakingTokens[_stakingToken];
        RewardsToken storage rewardsToken = stakingToken.rewardsTokens[_rewardsToken];
        EnumerableSet.AddressSet storage rewarders = rewardsToken.whitelistedRewarders;
        require(rewarders.contains(msg.sender), "Reward must be configured with addReward");

        Reward storage reward = rewardsToken.rewards[msg.sender];
        require(block.timestamp > reward.periodFinish, "Reward period still active");

        reward.duration = _duration;
        emit RewardsDurationUpdated(address(_stakingToken), address(_rewardsToken), msg.sender, _duration);
    }

    /**
     * @notice Update unpaid rewards due to `_user` for all rewarders for a rewards token and updates last update time
     */
    function _updateReward(
        StakingToken storage stakingToken,
        IERC20 _rewardsToken,
        address _user
    ) internal {
        RewardsToken storage rewardsToken = stakingToken.rewardsTokens[_rewardsToken];
        EnumerableSet.AddressSet storage rewarders = rewardsToken.whitelistedRewarders;
        uint256 rewardersLength = rewarders.length();

        uint256 totalUnpaidRewards;
        User storage user = stakingToken.users[_user];

        for (uint256 i; i < rewardersLength; i++) {
            address _rewarder = rewarders.unchecked_at(i);
            Reward storage reward = rewardsToken.rewards[_rewarder];
            uint256 perToken = _rewardPerToken(stakingToken, reward);

            reward.rewardPerTokenStored = perToken;
            reward.lastUpdateTime = _lastTimeRewardApplicable(reward);

            if (_user != address(0)) {
                totalUnpaidRewards = totalUnpaidRewards.add(
                    _unaccountedForUnpaidRewards(stakingToken, _rewardsToken, _rewarder, _user, reward)
                );
                user.paidRewards[_rewardsToken][_rewarder] = perToken;
            }
        }
        user.unpaidRewards[_rewardsToken] = totalUnpaidRewards;
    }

    /* ========== MODIFIERS ========== */
    /**
     * @notice
     * Updates the rewards due to `account` from all _rewardTokens and _rewarders
     */
    modifier updateReward(IERC20 _stakingToken, address _user) {
        StakingToken storage stakingToken = stakingTokens[_stakingToken];
        EnumerableSet.AddressSet storage rewardsTokens = stakingToken.whitelistedRewardsTokens;
        uint256 rewardTokensLength = rewardsTokens.length();
        for (uint256 i; i < rewardTokensLength; i++) {
            address _rewardToken = rewardsTokens.unchecked_at(i);
            _updateReward(stakingToken, IERC20(_rewardToken), _user);
        }
        _;
    }

    /* ========== EVENTS ========== */

    event Staked(address indexed stakingToken, address indexed account, uint256 amount);
    event Withdrawn(address indexed stakingToken, address indexed account, uint256 amount);
    event RewardAdded(
        address indexed stakingToken,
        address indexed rewardsToken,
        address indexed rewarder,
        uint256 amount
    );
    event RewardsDurationUpdated(
        address indexed stakingToken,
        address indexed rewardsToken,
        address indexed rewarder,
        uint256 newDuration
    );
}
