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

import "./interfaces/IMultiRewards.sol";
import "./interfaces/IDistributorCallback.sol";
import "./interfaces/IDistributor.sol";

import "./MultiRewardsAuthorization.sol";

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

    struct Reward {
        uint256 rewardsDuration;
        uint256 periodFinish;
        uint256 rewardRate;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
    }

    // stakingToken -> rewarder -> rewardToken -> RewardData
    mapping(IERC20 => mapping(address => mapping(IERC20 => Reward))) public rewardData;

    // stakingToken -> rewardTokens
    mapping(IERC20 => EnumerableSet.AddressSet) private _rewardTokens;

    // stakingToken -> rewardToken -> rewarders
    mapping(IERC20 => mapping(IERC20 => EnumerableSet.AddressSet)) private _rewarders;

    // stakingToken -> rewarder ->  user -> reward token -> amount
    mapping(IERC20 => mapping(address => mapping(address => mapping(IERC20 => uint256)))) public userRewardPerTokenPaid;

    // stakingToken -> user -> reward token -> amount
    mapping(IERC20 => mapping(address => mapping(IERC20 => uint256))) public unpaidRewards;

    mapping(IERC20 => uint256) private _totalSupply;

    // stakingToken -> user -> balance staked
    mapping(IERC20 => mapping(address => uint256)) private _balances;

    RewardsScheduler public immutable rewardsScheduler;

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
     * @param stakingToken The token that the rewarder can reward for
     * @param rewardsToken The token to be distributed to stakers
     * @param rewarder The address of the rewarder
     */
    function whitelistRewarder(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        address rewarder
    ) external override onlyWhitelisted(stakingToken) {
        _whitelistRewarder(stakingToken, rewardsToken, rewarder);
    }

    /**
     * @notice Whether a rewarder can reward a staking token with a reward token
     * @param stakingToken The token that the rewarder can reward for
     * @param rewardsToken The token to be distributed to stakers
     * @param rewarder The address of the rewarder
     */
    function isWhitelistedRewarder(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        address rewarder
    ) public view override returns (bool) {
        return _isWhitelistedRewarder(stakingToken, rewardsToken, rewarder);
    }

    /**
     * @notice Adds a new reward token to be distributed
     * @param stakingToken The staking token that will receive rewards
     * @param rewardsToken The new token to be distributed to stakers
     * @param rewardsDuration The duration over which each distribution is spread
     */
    function addReward(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        uint256 rewardsDuration
    ) external override onlyWhitelistedRewarder(stakingToken, rewardsToken) {
        require(rewardsDuration > 0, "reward rate must be nonzero");
        require(rewardData[stakingToken][msg.sender][rewardsToken].rewardsDuration == 0, "Duplicate rewards token");
        _rewardTokens[stakingToken].add(address(rewardsToken));
        _rewarders[stakingToken][rewardsToken].add(msg.sender);
        rewardData[stakingToken][msg.sender][rewardsToken].rewardsDuration = rewardsDuration;
        rewardsToken.approve(address(getVault()), type(uint256).max);
    }

    /* ========== VIEWS ========== */

    /**
     * @dev Tells the total supply for a staking token
     * @param stakingToken The staking token being queried
     */
    function totalSupply(IERC20 stakingToken) external view returns (uint256) {
        return _totalSupply[stakingToken];
    }

    /**
     * @dev Tells the staked balance of a user for a staking token
     * @param stakingToken The staking token being queried
     * @param account The address of the user with staked balance
     */
    function balanceOf(IERC20 stakingToken, address account) external view returns (uint256) {
        return _balances[stakingToken][account];
    }

    /**
     * @notice This time is used when determining up until what time a reward has been accounted for
     * @param stakingToken The staking token being queried
     * @param rewarder The address of the rewarder
     * @param rewardsToken The token to be distributed to stakers
     */
    function lastTimeRewardApplicable(
        IERC20 stakingToken,
        address rewarder,
        IERC20 rewardsToken
    ) public view returns (uint256) {
        return _lastTimeRewardApplicable(rewardData[stakingToken][rewarder][rewardsToken]);
    }

    function _lastTimeRewardApplicable(Reward storage data) private view returns (uint256) {
        return Math.min(block.timestamp, data.periodFinish);
    }

    /**
     * @notice Calculates the amount of reward token per staked tokens
     * @param stakingToken The staking token being queried
     * @param rewarder The address of the rewarder
     * @param rewardsToken The token to be distributed to stakers
     */
    function rewardPerToken(
        IERC20 stakingToken,
        address rewarder,
        IERC20 rewardsToken
    ) public view returns (uint256) {
        return _rewardPerToken(stakingToken, rewardData[stakingToken][rewarder][rewardsToken]);
    }

    function _rewardPerToken(IERC20 stakingToken, Reward storage data) private view returns (uint256) {
        if (_totalSupply[stakingToken] == 0) {
            return data.rewardPerTokenStored;
        }
        // Underflow is impossible here because lastTimeRewardApplicable(...) is always greater than
        // last update time
        uint256 unrewardedDuration = _lastTimeRewardApplicable(data) - data.lastUpdateTime;

        return
            data.rewardPerTokenStored.add(
                Math.mul(unrewardedDuration, data.rewardRate).divDown(_totalSupply[stakingToken])
            );
    }

    /**
     * @notice Calculates the amount of `rewardsToken` that `account` is able to claim from a particular rewarder
     * @param stakingToken The staking token being queried
     * @param rewarder The address of the rewarder
     * @param account The address receiving the rewards
     * @param rewardsToken The token to be distributed to stakers
     */
    function unaccountedForUnpaidRewards(
        IERC20 stakingToken,
        address rewarder,
        address account,
        IERC20 rewardsToken
    ) public view returns (uint256) {
        return
            _balances[stakingToken][account].mulDown(
                rewardPerToken(stakingToken, rewarder, rewardsToken).sub(
                    userRewardPerTokenPaid[stakingToken][rewarder][account][rewardsToken]
                )
            );
    }

    function _unaccountedForUnpaidRewards(
        IERC20 stakingToken,
        address rewarder,
        address account,
        IERC20 rewardsToken,
        Reward storage data
    ) private view returns (uint256) {
        return
            _balances[stakingToken][account].mulDown(
                _rewardPerToken(stakingToken, data).sub(
                    userRewardPerTokenPaid[stakingToken][rewarder][account][rewardsToken]
                )
            );
    }

    /**
     * @notice Calculates the total amount of `rewardsToken` that `account` is able to claim
     * @param stakingToken The staking token being queried
     * @param account The address receiving the rewards
     * @param rewardsToken The token to be distributed to stakers
     */
    function totalEarned(
        IERC20 stakingToken,
        address account,
        IERC20 rewardsToken
    ) public view returns (uint256 total) {
        uint256 rewardersLength = _rewarders[stakingToken][rewardsToken].length();
        for (uint256 r; r < rewardersLength; r++) {
            total = total.add(
                unaccountedForUnpaidRewards(
                    stakingToken,
                    _rewarders[stakingToken][rewardsToken].unchecked_at(r),
                    account,
                    rewardsToken
                )
            );
        }
        total = total.add(unpaidRewards[stakingToken][account][rewardsToken]);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */
    /**
     * @notice stakes a token on the msg.sender's behalf
     * @param stakingToken The token to be staked to earn rewards
     * @param amount Amount of tokens to be staked
     */
    function stake(IERC20 stakingToken, uint256 amount) external nonReentrant {
        _stakeFor(stakingToken, amount, msg.sender, msg.sender);
    }

    /**
     * @notice Stakes a token so that `receiver` can earn rewards
     * @param stakingToken The token to be staked to earn rewards
     * @param amount Amount of tokens to be staked
     * @param receiver The recipient of claimed rewards
     */
    function stakeFor(
        IERC20 stakingToken,
        uint256 amount,
        address receiver
    ) external nonReentrant {
        _stakeFor(stakingToken, amount, msg.sender, receiver);
    }

    function _stakeFor(
        IERC20 stakingToken,
        uint256 amount,
        address account,
        address receiver
    ) internal updateReward(stakingToken, receiver) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply[stakingToken] = _totalSupply[stakingToken].add(amount);
        _balances[stakingToken][receiver] = _balances[stakingToken][receiver].add(amount);
        stakingToken.safeTransferFrom(account, address(this), amount);
        emit Staked(address(stakingToken), receiver, amount);
    }

    /**
     * @notice Stake tokens using a permit signature for approval
     * @param stakingToken The token to be staked to earn rewards
     * @param amount Amount of tokens to be staked
     * @param deadline The time at which this expires (unix time)
     * @param v V of the signature
     * @param r R of the signature
     * @param s S of the signature
     */
    function stakeWithPermit(
        IERC20 stakingToken,
        uint256 amount,
        uint256 deadline,
        address account,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        IERC20Permit(address(stakingToken)).permit(account, address(this), amount, deadline, v, r, s);
        _stakeFor(stakingToken, amount, account, account);
    }

    /**
     * @notice Untakes tokens
     * @param stakingToken The token to be unstaked
     * @param amount Amount of tokens to be unstaked
     * @param receiver The recipient of the staked tokens
     */
    function unstake(
        IERC20 stakingToken,
        uint256 amount,
        address receiver
    ) public nonReentrant updateReward(stakingToken, msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply[stakingToken] = _totalSupply[stakingToken].sub(amount);
        _balances[stakingToken][msg.sender] = _balances[stakingToken][msg.sender].sub(amount);
        stakingToken.safeTransfer(receiver, amount);
        emit Withdrawn(address(stakingToken), receiver, amount);
    }

    /**
     * @notice Allows a user to claim any rewards to an EOA
     * @param stakingTokens The staking tokens to claim rewards for
     */
    function getReward(IERC20[] calldata stakingTokens) external nonReentrant {
        _getReward(stakingTokens, msg.sender, false);
    }

    /**
     * @notice Allows a user to claim any rewards to an internal balance
     * @param stakingTokens The staking tokens to claim rewards for
     */
    function getRewardAsInternalBalance(IERC20[] calldata stakingTokens) external nonReentrant {
        _getReward(stakingTokens, msg.sender, true);
    }

    function _rewardOpsCount(IERC20[] calldata stakingTokens) internal view returns (uint256 opsCount) {
        for (uint256 p; p < stakingTokens.length; p++) {
            IERC20 stakingToken = stakingTokens[p];
            uint256 rewardTokensLength = _rewardTokens[stakingToken].length();
            opsCount += rewardTokensLength;
        }
    }

    /**
     * @notice Allows a user to claim any rewards to an internal balance or EOA
     */
    function _getReward(
        IERC20[] calldata stakingTokens,
        address recipient,
        bool asInternalBalance
    ) internal {
        IVault.UserBalanceOpKind kind = asInternalBalance
            ? IVault.UserBalanceOpKind.TRANSFER_INTERNAL
            : IVault.UserBalanceOpKind.WITHDRAW_INTERNAL;

        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](_rewardOpsCount(stakingTokens));

        uint256 idx;
        for (uint256 p; p < stakingTokens.length; p++) {
            IERC20 stakingToken = stakingTokens[p];

            uint256 tokensLength = _rewardTokens[stakingToken].length();
            for (uint256 t; t < tokensLength; t++) {
                IERC20 rewardsToken = IERC20(_rewardTokens[stakingToken].unchecked_at(t));

                _updateReward(stakingToken, msg.sender, rewardsToken);
                uint256 reward = unpaidRewards[stakingToken][msg.sender][rewardsToken];

                if (reward > 0) {
                    unpaidRewards[stakingToken][msg.sender][rewardsToken] = 0;

                    emit RewardPaid(msg.sender, address(rewardsToken), reward);
                }

                ops[idx] = IVault.UserBalanceOp({
                    asset: IAsset(address(rewardsToken)),
                    amount: reward,
                    sender: address(this),
                    recipient: payable(recipient),
                    kind: kind
                });
                idx++;
            }
        }
        getVault().manageUserBalance(ops);
    }

    /**
     * @notice Allows the user to claim rewards to a callback contract
     * @param stakingTokens An array of staking tokens from which rewards will be claimed
     * @param callbackContract The contract where rewards will be transferred
     * @param callbackData The data that is used to call the callback contract's 'callback' method
     */
    function getRewardWithCallback(
        IERC20[] calldata stakingTokens,
        IDistributorCallback callbackContract,
        bytes calldata callbackData
    ) external nonReentrant {
        _getReward(stakingTokens, address(callbackContract), true);

        callbackContract.distributorCallback(callbackData);
    }

    /**
     * @notice Allows a user to unstake all their tokens
     * @param stakingTokens The staking tokens to unstake tokens for
     */
    function exit(IERC20[] calldata stakingTokens) external {
        for (uint256 p; p < stakingTokens.length; p++) {
            IERC20 stakingToken = stakingTokens[p];
            unstake(stakingToken, _balances[stakingToken][msg.sender], msg.sender);
        }
        _getReward(stakingTokens, msg.sender, false);
    }

    /**
     * @notice Allows a user to unstake transferring rewards to the user and the unstaked tokens to a callback contract
     * @param stakingTokens The staking tokens to claim rewards for
     * @param callbackContract The contract where the staked tokens will be transferred
     * @param callbackData The data that is used to call the callback contract's 'callback' method
     */
    function exitWithCallback(
        IERC20[] calldata stakingTokens,
        IDistributorCallback callbackContract,
        bytes calldata callbackData
    ) external {
        for (uint256 p; p < stakingTokens.length; p++) {
            IERC20 stakingToken = stakingTokens[p];
            unstake(stakingToken, _balances[stakingToken][msg.sender], address(callbackContract));
        }
        _getReward(stakingTokens, msg.sender, false);
        callbackContract.distributorCallback(callbackData);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /**
     * @notice Allows a rewards distributor, or the reward scheduler
     * to deposit more tokens to be distributed as rewards
     * @param stakingToken The staking token being rewarded
     * @param rewardsToken The token to deposit into staking contract for distribution
     * @param reward The amount of tokens to deposit
     * @param rewarder The address issuing the reward (usually msg.sender)
     */
    function notifyRewardAmount(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        uint256 reward,
        address rewarder
    ) external override updateReward(stakingToken, address(0)) {
        require(
            msg.sender == rewarder || msg.sender == address(rewardsScheduler),
            "Rewarder must be sender, or rewards scheduler"
        );

        require(_rewarders[stakingToken][rewardsToken].contains(rewarder), "Reward must be configured with addReward");

        // handle the transfer of reward tokens via `safeTransferFrom` to reduce the number
        // of transactions required and ensure correctness of the reward amount
        // Tokens always come from msg.sender because either `msg.sender == rewarder`
        // or the`rewardsScheduler` is holding tokens on behalf of the `rewarder`
        rewardsToken.safeTransferFrom(msg.sender, address(this), reward);

        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);

        ops[0] = IVault.UserBalanceOp({
            asset: IAsset(address(rewardsToken)),
            amount: reward,
            sender: address(this),
            recipient: payable(address(this)),
            kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
        });

        getVault().manageUserBalance(ops);

        // Save the storage pointer to compute the slot only once.
        Reward storage data = rewardData[stakingToken][rewarder][rewardsToken];

        // Cache storage variables to avoid repeated access.
        uint256 periodFinish = data.periodFinish;
        uint256 rewardsDuration = data.rewardsDuration;

        if (block.timestamp >= periodFinish) {
            data.rewardRate = Math.divDown(reward, rewardsDuration);
        } else {
            uint256 remainingTime = periodFinish - block.timestamp; // Checked arithmetic is not required due to the if
            uint256 leftoverRewards = Math.mul(remainingTime, data.rewardRate);
            data.rewardRate = Math.divDown(reward.add(leftoverRewards), rewardsDuration);
        }

        data.lastUpdateTime = block.timestamp;
        data.periodFinish = block.timestamp.add(rewardsDuration);
        emit RewardAdded(address(stakingToken), address(rewardsToken), rewarder, reward);
    }

    /**
     * @notice set the reward duration for a reward
     * @param stakingToken The staking token to be set
     * @param rewardsToken The token for the reward
     * @param rewardsDuration The duration over which each distribution is spread
     */
    function setRewardsDuration(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        uint256 rewardsDuration
    ) external onlyWhitelistedRewarder(stakingToken, rewardsToken) {
        require(
            _rewarders[stakingToken][rewardsToken].contains(msg.sender),
            "Reward must be configured with addReward"
        );
        require(
            block.timestamp > rewardData[stakingToken][msg.sender][rewardsToken].periodFinish,
            "Reward period still active"
        );
        require(rewardsDuration > 0, "Reward duration must be non-zero");
        rewardData[stakingToken][msg.sender][rewardsToken].rewardsDuration = rewardsDuration;
        emit RewardsDurationUpdated(
            address(stakingToken),
            address(rewardsToken),
            msg.sender,
            rewardData[stakingToken][msg.sender][rewardsToken].rewardsDuration
        );
    }

    /**
     * @notice update unpaid rewards due to `account` for all rewarders for a particular token
     *         and updates last update time
     */
    function _updateReward(
        IERC20 stakingToken,
        address account,
        IERC20 token
    ) internal {
        uint256 totalUnpaidRewards;

        // Save the storage pointer to compute the slot only once.
        EnumerableSet.AddressSet storage rewarders = _rewarders[stakingToken][token];
        uint256 rewardersLength = rewarders.length();

        for (uint256 r; r < rewardersLength; r++) {
            address rewarder = rewarders.unchecked_at(r);
            Reward storage data = rewardData[stakingToken][rewarder][token];

            // Cache storage variables to avoid repeated access.
            uint256 perToken = _rewardPerToken(stakingToken, data);
            data.rewardPerTokenStored = perToken;

            data.lastUpdateTime = _lastTimeRewardApplicable(data);
            if (account != address(0)) {
                totalUnpaidRewards = totalUnpaidRewards.add(
                    _unaccountedForUnpaidRewards(stakingToken, rewarder, account, token, data)
                );
                userRewardPerTokenPaid[stakingToken][rewarder][account][token] = perToken;
            }
        }

        unpaidRewards[stakingToken][account][token] = totalUnpaidRewards;
    }

    /* ========== MODIFIERS ========== */
    /**
     * @notice
     * Updates the rewards due to `account` from all _rewardTokens and _rewarders
     */
    modifier updateReward(IERC20 stakingToken, address account) {
        uint256 rewardTokensLength = _rewardTokens[stakingToken].length();
        for (uint256 t; t < rewardTokensLength; t++) {
            IERC20 rewardToken = IERC20(_rewardTokens[stakingToken].unchecked_at(t));
            _updateReward(stakingToken, account, rewardToken);
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
