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
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeMath.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20Permit.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAsset.sol";

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

    address public rewardsScheduler;

    /* ========== CONSTRUCTOR ========== */

    constructor(IVault _vault)
        // MultiRewards is a singleton, so it simply uses its own address to disambiguate action identifiers
        Authentication(bytes32(uint256(address(this))))
        MultiRewardsAuthorization(_vault)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function setRewardsScheduler(address rs) public onlyOwner {
        rewardsScheduler = rs;
    }

    /**
     * @notice Allows a rewarder to be explicitly added to an allowlist of rewarders
     */
    function allowlistRewarder(
        IERC20 pool,
        IERC20 rewardsToken,
        address rewarder
    ) external override onlyAllowlisters(pool) {
        _allowlistRewarder(pool, rewardsToken, rewarder);
    }

    /**
     * @notice Adds a new reward token to be distributed
     * @param pool - The bpt of the pool that will receive rewards
     * @param rewardsToken - The new token to be distributed to stakers
     * @param rewardsDuration - The duration over which each distribution is spread
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
     * @notice Total supply of a staking token being added
     */
    function totalSupply(IERC20 pool) external view returns (uint256) {
        return _totalSupply[pool];
    }

    /**
     * @notice The balance of a staking token than `account` has staked
     */
    function balanceOf(IERC20 pool, address account) external view returns (uint256) {
        return _balances[pool][account];
    }

    /**
     * @notice This time is used when determining up until what time a reward has been accounted for
     */
    function lastTimeRewardApplicable(
        IERC20 pool,
        address rewarder,
        IERC20 rewardsToken
    ) public view returns (uint256) {
        return Math.min(block.timestamp, rewardData[pool][rewarder][rewardsToken].periodFinish);
    }

    /**
     * @notice Calculates the amount of reward token per staked bpt
     */
    function rewardPerToken(
        IERC20 pool,
        address rewarder,
        IERC20 rewardsToken
    ) public view returns (uint256) {
        if (_totalSupply[pool] == 0) {
            return rewardData[pool][rewarder][rewardsToken].rewardPerTokenStored;
        }
        // Underflow is impossible here because lastTimeRewardApplicable(...) is always greater than
        // last update time
        uint256 unrewardedDuration = lastTimeRewardApplicable(pool, rewarder, rewardsToken) -
            rewardData[pool][rewarder][rewardsToken].lastUpdateTime;

        return
            rewardData[pool][rewarder][rewardsToken].rewardPerTokenStored.add(
                Math.mul(unrewardedDuration, rewardData[pool][rewarder][rewardsToken].rewardRate).divDown(
                    _totalSupply[pool]
                )
            );
    }

    /**
     * @notice Calculates the amount of `rewardsToken` that `account` is able to claim
     * from a particular rewarder
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

    /**
     * @notice Calculates the total amount of `rewardsToken` that `account` is able to claim
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

    function getRewardForDuration(
        IERC20 pool,
        address rewarder,
        IERC20 rewardsToken
    ) external view returns (uint256) {
        return
            Math.mul(
                rewardData[pool][rewarder][rewardsToken].rewardRate,
                rewardData[pool][rewarder][rewardsToken].rewardsDuration
            );
    }

    /* ========== MUTATIVE FUNCTIONS ========== */
    function stake(IERC20 pool, uint256 amount) external {
        stakeFor(pool, amount, msg.sender);
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
    ) public nonReentrant updateReward(pool, receiver) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply[pool] = _totalSupply[pool].add(amount);
        _balances[pool][receiver] = _balances[pool][receiver].add(amount);
        pool.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(address(pool), receiver, amount);
    }

    /**
     * @notice Stake tokens using a permit signature for approval
     * @param pool The bpt being staked to earn rewards
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
        address recipient,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IERC20Permit(address(pool)).permit(msg.sender, address(this), amount, deadline, v, r, s);
        stakeFor(pool, amount, recipient);
    }

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

    function getReward(IERC20[] calldata pools) external nonReentrant {
        _getReward(pools, msg.sender, false);
    }

    function getRewardAsInternalBalance(IERC20[] calldata pools) external nonReentrant {
        _getReward(pools, msg.sender, true);
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
        bool asInternalBalance
    ) internal {
        IVault.UserBalanceOpKind kind = asInternalBalance
            ? IVault.UserBalanceOpKind.TRANSFER_INTERNAL
            : IVault.UserBalanceOpKind.WITHDRAW_INTERNAL;

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
     * @param pools - An array of pools from which rewards will be claimed
     * @param callbackContract - the contract where rewards will be transferred
     * @param callbackData - the data that is used to call the callback contract's 'callback' method
     */

    function getRewardWithCallback(
        IERC20[] calldata pools,
        IDistributorCallback callbackContract,
        bytes calldata callbackData
    ) external nonReentrant {
        _getReward(pools, address(callbackContract), true);

        callbackContract.distributorCallback(callbackData);
    }

    /**
     * @notice Allows a user to unstake all their tokens
     */
    function exit(IERC20[] calldata pools) external {
        for (uint256 p; p < pools.length; p++) {
            IERC20 pool = pools[p];
            unstake(pool, _balances[pool][msg.sender], msg.sender);
        }
        _getReward(pools, msg.sender, false);
    }

    /**
     * @notice Allows a user to unstake all their bpt to exit pools
     *         and transfers them all the rewards
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
        _getReward(pools, msg.sender, false);
        callbackContract.distributorCallback(callbackData);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /**
     * @notice Allows a rewards distributor, or the reward scheduler
     * to deposit more tokens to be distributed as rewards
     * @param rewardsToken - the token to deposit into staking contract for distribution
     * @param reward - the amount of tokens to deposit
     * @param rewarder - the address issuing the reward (usually msg.sender)
     */
    function notifyRewardAmount(
        IERC20 pool,
        IERC20 rewardsToken,
        uint256 reward,
        address rewarder
    ) external override updateReward(pool, address(0)) {
        require(
            rewarder == msg.sender || msg.sender == rewardsScheduler,
            "Rewarder must be sender, or rewards scheduler"
        );

        require(_rewarders[pool][rewardsToken].contains(msg.sender), "Reward must be configured with addReward");

        // handle the transfer of reward tokens via `safeTransferFrom` to reduce the number
        // of transactions required and ensure correctness of the reward amount
        address funder = (msg.sender == rewardsScheduler) ? rewardsScheduler : msg.sender;
        rewardsToken.safeTransferFrom(funder, address(this), reward);

        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);

        ops[0] = IVault.UserBalanceOp({
            asset: IAsset(address(rewardsToken)),
            amount: reward,
            sender: address(this),
            recipient: payable(address(this)),
            kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
        });

        getVault().manageUserBalance(ops);

        if (block.timestamp >= rewardData[pool][rewarder][rewardsToken].periodFinish) {
            rewardData[pool][rewarder][rewardsToken].rewardRate = Math.divDown(
                reward,
                rewardData[pool][rewarder][rewardsToken].rewardsDuration
            );
        } else {
            uint256 remaining = rewardData[pool][rewarder][rewardsToken].periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mulDown(rewardData[pool][rewarder][rewardsToken].rewardRate);
            rewardData[pool][rewarder][rewardsToken].rewardRate = Math.divDown(
                reward.add(leftover),
                rewardData[pool][rewarder][rewardsToken].rewardsDuration
            );
        }

        rewardData[pool][rewarder][rewardsToken].lastUpdateTime = block.timestamp;
        rewardData[pool][rewarder][rewardsToken].periodFinish = block.timestamp.add(
            rewardData[pool][rewarder][rewardsToken].rewardsDuration
        );
        emit RewardAdded(address(rewardsToken), reward);
    }

    function setRewardsDuration(
        IERC20 pool,
        IERC20 rewardsToken,
        uint256 rewardsDuration
    ) external {
        require(
            block.timestamp > rewardData[pool][msg.sender][rewardsToken].periodFinish,
            "Reward period still active"
        );
        require(rewardsDuration > 0, "Reward duration must be non-zero");
        rewardData[pool][msg.sender][rewardsToken].rewardsDuration = rewardsDuration;
        emit RewardsDurationUpdated(
            address(pool),
            address(rewardsToken),
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
        for (uint256 r; r < _rewarders[pool][token].length(); r++) {
            address rewarder = _rewarders[pool][token].unchecked_at(r);

            rewardData[pool][rewarder][token].rewardPerTokenStored = rewardPerToken(pool, rewarder, token);
            rewardData[pool][rewarder][token].lastUpdateTime = lastTimeRewardApplicable(pool, rewarder, token);
            if (account != address(0)) {
                totalUnpaidRewards = totalUnpaidRewards.add(
                    unaccountedForUnpaidRewards(pool, rewarder, account, token)
                );
                userRewardPerTokenPaid[pool][rewarder][account][token] = rewardData[pool][rewarder][token]
                    .rewardPerTokenStored;
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
    event RewardsDurationUpdated(address indexed pool, address token, uint256 newDuration);
}
