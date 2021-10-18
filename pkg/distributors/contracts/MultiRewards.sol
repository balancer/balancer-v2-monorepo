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

    // pool -> rewarder -> rewardToken -> RewardData
    mapping(IERC20 => mapping(address => mapping(IERC20 => Reward))) public rewardData;

    // pool -> rewardTokens
    mapping(IERC20 => EnumerableSet.AddressSet) private _rewardTokens;

    // pool -> rewardToken -> rewarders
    mapping(IERC20 => mapping(IERC20 => EnumerableSet.AddressSet)) private _rewarders;

    // pool -> rewarder ->  user -> reward token -> amount
    mapping(IERC20 => mapping(address => mapping(address => mapping(IERC20 => uint256)))) public userRewardPerTokenPaid;

    // pool -> user -> reward token -> amount
    mapping(IERC20 => mapping(address => mapping(IERC20 => uint256))) public unpaidRewards;

    mapping(IERC20 => uint256) private _totalSupply;

    // pool -> user -> bpt balance staked
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
     * @notice Allows a rewarder to be explicitly added to an allowlist of rewarders
     * @param pool The bpt of the pool that the rewarder can reward
     * @param rewardsToken The token to be distributed to stakers
     * @param rewarder The address of the rewarder
     */
    function allowlistRewarder(
        IERC20 pool,
        IERC20 rewardsToken,
        address rewarder
    ) external override onlyAllowlisters(pool) {
        _allowlistRewarder(pool, rewardsToken, rewarder);
    }

    /**
     * @notice Whether a rewarder can reward bpt of a pool with a token
     * @param pool The bpt of the pool
     * @param rewardsToken The token to be distributed to stakers
     * @param rewarder The address of the rewarder
     */
    function isAllowlistedRewarder(
        IERC20 pool,
        IERC20 rewardsToken,
        address rewarder
    ) public view override returns (bool) {
        return _isAllowlistedRewarder(pool, rewardsToken, rewarder);
    }

    /**
     * @notice Adds a new reward token to be distributed
     * @param pool The bpt of the pool that will receive rewards
     * @param rewardsToken The new token to be distributed to stakers
     * @param rewardsDuration The duration over which each distribution is spread
     */
    function addReward(
        IERC20 pool,
        IERC20 rewardsToken,
        uint256 rewardsDuration
    ) external override onlyAllowlistedRewarder(pool, rewardsToken) {
        require(rewardsDuration > 0, "reward rate must be nonzero");
        require(rewardData[pool][msg.sender][rewardsToken].rewardsDuration == 0, "Duplicate rewards token");
        _rewardTokens[pool].add(address(rewardsToken));
        _rewarders[pool][rewardsToken].add(msg.sender);
        rewardData[pool][msg.sender][rewardsToken].rewardsDuration = rewardsDuration;
        rewardsToken.approve(address(getVault()), type(uint256).max);
    }

    /* ========== VIEWS ========== */

    /**
     * @notice Total supply of a pools bpt that has been staked
     * @param pool The bpt of the pool
     */
    function totalSupply(IERC20 pool) external view returns (uint256) {
        return _totalSupply[pool];
    }

    /**
     * @notice The balance of a pools bpt that `account` has staked
     * @param pool The bpt of the pool
     * @param account The address of the user with staked bpt
     */
    function balanceOf(IERC20 pool, address account) external view returns (uint256) {
        return _balances[pool][account];
    }

    /**
     * @notice This time is used when determining up until what time a reward has been accounted for
     * @param pool The bpt of the pool
     * @param rewarder The address of the rewarder
     * @param rewardsToken The token to be distributed to stakers
     */
    function lastTimeRewardApplicable(
        IERC20 pool,
        address rewarder,
        IERC20 rewardsToken
    ) public view returns (uint256) {
        return _lastTimeRewardApplicable(rewardData[pool][rewarder][rewardsToken]);
    }

    function _lastTimeRewardApplicable(Reward storage data) private view returns (uint256) {
        return Math.min(block.timestamp, data.periodFinish);
    }

    /**
     * @notice Calculates the amount of reward token per staked bpt
     * @param pool The bpt of the pool
     * @param rewarder The address of the rewarder
     * @param rewardsToken The token to be distributed to stakers
     */
    function rewardPerToken(
        IERC20 pool,
        address rewarder,
        IERC20 rewardsToken
    ) public view returns (uint256) {
        return _rewardPerToken(pool, rewardData[pool][rewarder][rewardsToken]);
    }

    function _rewardPerToken(IERC20 pool, Reward storage data) private view returns (uint256) {
        if (_totalSupply[pool] == 0) {
            return data.rewardPerTokenStored;
        }
        // Underflow is impossible here because lastTimeRewardApplicable(...) is always greater than
        // last update time
        uint256 unrewardedDuration = _lastTimeRewardApplicable(data) - data.lastUpdateTime;

        return data.rewardPerTokenStored.add(Math.mul(unrewardedDuration, data.rewardRate).divDown(_totalSupply[pool]));
    }

    /**
     * @notice Calculates the amount of `rewardsToken` that `account` is able to claim
     * from a particular rewarder
     * @param pool The bpt of the pool
     * @param rewarder The address of the rewarder
     * @param account The address receiving the rewards
     * @param rewardsToken The token to be distributed to stakers
     */
    function unaccountedForUnpaidRewards(
        IERC20 pool,
        address rewarder,
        address account,
        IERC20 rewardsToken
    ) public view returns (uint256) {
        return
            _balances[pool][account].mulDown(
                rewardPerToken(pool, rewarder, rewardsToken).sub(
                    userRewardPerTokenPaid[pool][rewarder][account][rewardsToken]
                )
            );
    }

    function _unaccountedForUnpaidRewards(
        IERC20 pool,
        address rewarder,
        address account,
        IERC20 rewardsToken,
        Reward storage data
    ) private view returns (uint256) {
        return
            _balances[pool][account].mulDown(
                _rewardPerToken(pool, data).sub(userRewardPerTokenPaid[pool][rewarder][account][rewardsToken])
            );
    }

    /**
     * @notice Calculates the total amount of `rewardsToken` that `account` is able to claim
     * @param pool The bpt of the pool
     * @param account The address receiving the rewards
     * @param rewardsToken The token to be distributed to stakers
     */
    function totalEarned(
        IERC20 pool,
        address account,
        IERC20 rewardsToken
    ) public view returns (uint256 total) {
        uint256 rewardersLength = _rewarders[pool][rewardsToken].length();
        for (uint256 r; r < rewardersLength; r++) {
            total = total.add(
                unaccountedForUnpaidRewards(pool, _rewarders[pool][rewardsToken].unchecked_at(r), account, rewardsToken)
            );
        }
        total = total.add(unpaidRewards[pool][account][rewardsToken]);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */
    /**
     * @notice stakes a token on the msg.sender's behalf
     * @param pool The bpt of the pool that the rewarder can reward
     * @param amount Amount of `pool` to stake
     */
    function stake(IERC20 pool, uint256 amount) external nonReentrant {
        _stakeFor(pool, amount, msg.sender, msg.sender);
    }

    /**
     * @notice Stakes a token so that `receiver` can earn rewards
     * @param pool The token being staked to earn rewards
     * @param amount Amount of `pool` to stake
     * @param receiver The recipient of claimed rewards
     */
    function stakeFor(
        IERC20 pool,
        uint256 amount,
        address receiver
    ) external nonReentrant {
        _stakeFor(pool, amount, msg.sender, receiver);
    }

    function _stakeFor(
        IERC20 pool,
        uint256 amount,
        address account,
        address receiver
    ) internal updateReward(pool, receiver) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply[pool] = _totalSupply[pool].add(amount);
        _balances[pool][receiver] = _balances[pool][receiver].add(amount);
        pool.safeTransferFrom(account, address(this), amount);
        emit Staked(address(pool), receiver, amount);
    }

    /**
     * @notice Stake tokens using a permit signature for approval
     * @param pool      The bpt being staked to earn rewards
     * @param amount    Amount of allowance
     * @param deadline  The time at which this expires (unix time)
     * @param v         v of the signature
     * @param r         r of the signature
     * @param s         s of the signature
     */
    function stakeWithPermit(
        IERC20 pool,
        uint256 amount,
        uint256 deadline,
        address account,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        IERC20Permit(address(pool)).permit(account, address(this), amount, deadline, v, r, s);
        _stakeFor(pool, amount, account, account);
    }

    /**
     * @notice Untakes a token
     * @param pool The token being staked to earn rewards
     * @param amount Amount of `pool` to unstake
     * @param receiver The recipient of the bpt
     */
    function unstake(
        IERC20 pool,
        uint256 amount,
        address receiver
    ) public nonReentrant updateReward(pool, msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply[pool] = _totalSupply[pool].sub(amount);
        _balances[pool][msg.sender] = _balances[pool][msg.sender].sub(amount);
        pool.safeTransfer(receiver, amount);
        emit Withdrawn(address(pool), receiver, amount);
    }

    /**
     * @notice Allows a user to claim any rewards to an EOA
     * @param pools The pools to claim rewards for
     */
    function getReward(IERC20[] calldata pools) external nonReentrant {
        _getReward(pools, msg.sender, IVault.UserBalanceOpKind.WITHDRAW_INTERNAL);
    }

    /**
     * @notice Allows a user to claim any rewards to an internal balance
     * @param pools The pools to claim rewards for
     */
    function getRewardAsInternalBalance(IERC20[] calldata pools) external nonReentrant {
        _getReward(pools, msg.sender, IVault.UserBalanceOpKind.TRANSFER_INTERNAL);
    }

    function _rewardOpsCount(IERC20[] calldata pools) internal view returns (uint256 opsCount) {
        for (uint256 p; p < pools.length; p++) {
            IERC20 pool = pools[p];
            uint256 rewardTokensLength = _rewardTokens[pool].length();
            opsCount += rewardTokensLength;
        }
    }

    /**
     * @notice Allows a user to claim any rewards to an internal balance or EOA
     */
    function _getReward(
        IERC20[] calldata pools,
        address recipient,
        IVault.UserBalanceOpKind kind
    ) internal {
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](_rewardOpsCount(pools));

        uint256 idx;
        for (uint256 p; p < pools.length; p++) {
            IERC20 pool = pools[p];

            uint256 tokensLength = _rewardTokens[pool].length();
            for (uint256 t; t < tokensLength; t++) {
                IERC20 rewardsToken = IERC20(_rewardTokens[pool].unchecked_at(t));

                _updateReward(pool, msg.sender, rewardsToken);
                uint256 reward = unpaidRewards[pool][msg.sender][rewardsToken];

                if (reward > 0) {
                    unpaidRewards[pool][msg.sender][rewardsToken] = 0;

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
     * @param pools An array of pools from which rewards will be claimed
     * @param callbackContract The contract where rewards will be transferred
     * @param callbackData The data that is used to call the callback contract's 'callback' method
     */
    function getRewardWithCallback(
        IERC20[] calldata pools,
        IDistributorCallback callbackContract,
        bytes calldata callbackData
    ) external nonReentrant {
        _getReward(pools, address(callbackContract), IVault.UserBalanceOpKind.TRANSFER_INTERNAL);

        callbackContract.distributorCallback(callbackData);
    }

    /**
     * @notice Allows a user to unstake all their tokens
     * @param pools The pools to unstake tokens for
     */
    function exit(IERC20[] calldata pools) external {
        for (uint256 p; p < pools.length; p++) {
            IERC20 pool = pools[p];
            unstake(pool, _balances[pool][msg.sender], msg.sender);
        }
        _getReward(pools, msg.sender, IVault.UserBalanceOpKind.WITHDRAW_INTERNAL);
    }

    /**
     * @notice Allows a user to unstake all their bpt to exit pools, transferring accrued rewards to the user
     * and the unstaked bpt to a callback contract
     * @param pools The pools to claim rewards for
     * @param callbackContract The contract where bpt will be transferred
     * @param callbackData The data that is used to call the callback contract's 'callback' method
     */
    function exitWithCallback(
        IERC20[] calldata pools,
        IDistributorCallback callbackContract,
        bytes calldata callbackData
    ) external {
        for (uint256 p; p < pools.length; p++) {
            IERC20 pool = pools[p];
            unstake(pool, _balances[pool][msg.sender], address(callbackContract));
        }
        _getReward(pools, msg.sender, IVault.UserBalanceOpKind.WITHDRAW_INTERNAL);
        callbackContract.distributorCallback(callbackData);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /**
     * @notice Allows a rewards distributor, or the reward scheduler
     * to deposit more tokens to be distributed as rewards
     * @param pool The pool bpt that is staked in this contract
     * @param rewardsToken The token to deposit into staking contract for distribution
     * @param reward The amount of tokens to deposit
     * @param rewarder The address issuing the reward (usually msg.sender)
     */
    function notifyRewardAmount(
        IERC20 pool,
        IERC20 rewardsToken,
        uint256 reward,
        address rewarder
    ) external override updateReward(pool, address(0)) {
        require(
            msg.sender == rewarder || msg.sender == address(rewardsScheduler),
            "Rewarder must be sender, or rewards scheduler"
        );

        require(_rewarders[pool][rewardsToken].contains(rewarder), "Reward must be configured with addReward");

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
        Reward storage data = rewardData[pool][rewarder][rewardsToken];

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
        emit RewardAdded(address(pool), address(rewardsToken), rewarder, reward);
    }

    /**
     * @notice set the reward duration for a reward
     * @param pool The pool's bpt
     * @param rewardsToken The token for the reward
     * @param rewardsDuration The duration over which each distribution is spread
     */
    function setRewardsDuration(
        IERC20 pool,
        IERC20 rewardsToken,
        uint256 rewardsDuration
    ) external onlyAllowlistedRewarder(pool, rewardsToken) {
        require(_rewarders[pool][rewardsToken].contains(msg.sender), "Reward must be configured with addReward");
        require(
            block.timestamp > rewardData[pool][msg.sender][rewardsToken].periodFinish,
            "Reward period still active"
        );
        require(rewardsDuration > 0, "Reward duration must be non-zero");
        rewardData[pool][msg.sender][rewardsToken].rewardsDuration = rewardsDuration;
        emit RewardsDurationUpdated(
            address(pool),
            address(rewardsToken),
            msg.sender,
            rewardData[pool][msg.sender][rewardsToken].rewardsDuration
        );
    }

    /**
     * @notice update unpaid rewards due to `account` for all rewarders for a particular token
     *         and updates last update time
     */
    function _updateReward(
        IERC20 pool,
        address account,
        IERC20 token
    ) internal {
        uint256 totalUnpaidRewards;

        // Save the storage pointer to compute the slot only once.
        EnumerableSet.AddressSet storage rewarders = _rewarders[pool][token];
        uint256 rewardersLength = rewarders.length();

        for (uint256 r; r < rewardersLength; r++) {
            address rewarder = rewarders.unchecked_at(r);
            Reward storage data = rewardData[pool][rewarder][token];

            // Cache storage variables to avoid repeated access.
            uint256 perToken = _rewardPerToken(pool, data);
            data.rewardPerTokenStored = perToken;

            data.lastUpdateTime = _lastTimeRewardApplicable(data);
            if (account != address(0)) {
                totalUnpaidRewards = totalUnpaidRewards.add(
                    _unaccountedForUnpaidRewards(pool, rewarder, account, token, data)
                );
                userRewardPerTokenPaid[pool][rewarder][account][token] = perToken;
            }
        }

        unpaidRewards[pool][account][token] = totalUnpaidRewards;
    }

    /* ========== MODIFIERS ========== */
    /**
     * @notice
     * Updates the rewards due to `account` from all _rewardTokens and _rewarders
     */
    modifier updateReward(IERC20 pool, address account) {
        uint256 rewardTokensLength = _rewardTokens[pool].length();
        for (uint256 t; t < rewardTokensLength; t++) {
            IERC20 rewardToken = IERC20(_rewardTokens[pool].unchecked_at(t));
            _updateReward(pool, account, rewardToken);
        }
        _;
    }

    /* ========== EVENTS ========== */

    event Staked(address indexed pool, address indexed account, uint256 amount);
    event Withdrawn(address indexed pool, address indexed account, uint256 amount);
    event RewardAdded(address indexed pool, address indexed token, address indexed rewarder, uint256 amount);
    event RewardsDurationUpdated(
        address indexed pool,
        address indexed token,
        address indexed rewarder,
        uint256 newDuration
    );
}
