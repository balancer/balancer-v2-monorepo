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
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/TemporarilyPausable.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeMath.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20Permit.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAsset.sol";

import "./interfaces/IMultiRewards.sol";
import "./interfaces/IDistributor.sol";

// solhint-disable not-rely-on-time

/**
 * Balancer MultiRewards claim contract (claim to internal balance) based on
 * Curve Finance's MultiRewards contract, updated to be compatible with solc 0.7.0
 * https://github.com/curvefi/multi-rewards/blob/master/contracts/MultiRewards.sol commit #9947623
 */

contract MultiRewards is IMultiRewards, IDistributor, ReentrancyGuard, TemporarilyPausable, Ownable {
    using FixedPoint for uint256;
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    struct Reward {
        address rewardsDistributor;
        uint256 rewardsDuration;
        uint256 periodFinish;
        uint256 rewardRate;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
    }
    IVault public immutable vault;
    IERC20 public immutable stakingToken;
    mapping(IERC20 => Reward) public rewardData;
    IERC20[] public rewardTokens;

    // user -> reward token -> amount
    mapping(address => mapping(IERC20 => uint256)) public userRewardPerTokenPaid;
    mapping(address => mapping(IERC20 => uint256)) public rewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    /* ========== CONSTRUCTOR ========== */

    constructor(IVault _vault, IERC20 _stakingToken) Ownable() TemporarilyPausable(3600, 3600) {
        vault = _vault;
        stakingToken = _stakingToken;
    }

    /**
     * @notice Adds a new reward token to be distributed
     * @param rewardsToken - The new token to be distributed to stakers
     * @param rewardsDistributor - The address which is designated to add `rewardsToken` to be distributed
     * @param rewardsDuration - The duration over which each distribution is spread
     */
    function addReward(
        IERC20 rewardsToken,
        address rewardsDistributor,
        uint256 rewardsDuration
    ) public onlyOwner {
        require(rewardsDuration > 0, "reward rate must be nonzero");
        require(rewardData[rewardsToken].rewardsDuration == 0, "Duplicate rewards token");
        rewardTokens.push(rewardsToken);
        rewardData[rewardsToken].rewardsDistributor = rewardsDistributor;
        rewardData[rewardsToken].rewardsDuration = rewardsDuration;
        IERC20(rewardsToken).approve(address(vault), type(uint256).max);
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable(IERC20 rewardsToken) public view returns (uint256) {
        return Math.min(block.timestamp, rewardData[rewardsToken].periodFinish);
    }

    function rewardPerToken(IERC20 rewardsToken) public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardData[rewardsToken].rewardPerTokenStored;
        }
        return
            rewardData[rewardsToken].rewardPerTokenStored.add(
                lastTimeRewardApplicable(rewardsToken)
                    .sub(rewardData[rewardsToken].lastUpdateTime)
                    .mulDown(rewardData[rewardsToken].rewardRate)
                    .mulDown(1e18)
                    .divDown(_totalSupply)
            );
    }

    /**
     * @notice Calculates the amount of `rewardsToken` that `account` is able to claim
     */
    function earned(address account, IERC20 rewardsToken) public view returns (uint256) {
        return
            _balances[account]
                .mulDown(rewardPerToken(rewardsToken).sub(userRewardPerTokenPaid[account][rewardsToken]))
                .divDown(1e18)
                .add(rewards[account][rewardsToken]);
    }

    function getRewardForDuration(IERC20 rewardsToken) external view returns (uint256) {
        return rewardData[rewardsToken].rewardRate.mulDown(rewardData[rewardsToken].rewardsDuration);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function setRewardsDistributor(IERC20 rewardsToken, address rewardsDistributor) external onlyOwner {
        rewardData[rewardsToken].rewardsDistributor = rewardsDistributor;
    }

    function stake(uint256 amount) external {
        stake(amount, msg.sender);
    }

    function stake(uint256 amount, address receiver) public nonReentrant whenNotPaused updateReward(receiver) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply = _totalSupply.add(amount);
        _balances[receiver] = _balances[receiver].add(amount);
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(receiver, amount);
    }

    /**
     * @notice Stake tokens using a permit signature for approval
     * @param amount    Amount of allowance
     * @param deadline  The time at which this expires (unix time)
     * @param v         v of the signature
     * @param r         r of the signature
     * @param s         s of the signature
     */
    function stakeWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        IERC20Permit(address(stakingToken)).permit(msg.sender, address(this), amount, deadline, v, r, s);
        stake(amount, msg.sender);
    }

    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply = _totalSupply.sub(amount);
        _balances[msg.sender] = _balances[msg.sender].sub(amount);
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Allows a user to claim any rewards which are due.
     */
    function getReward() public nonReentrant updateReward(msg.sender) {
        for (uint256 i; i < rewardTokens.length; i++) {
            IERC20 rewardsToken = rewardTokens[i];
            uint256 reward = rewards[msg.sender][rewardsToken];
            if (reward > 0) {
                rewards[msg.sender][rewardsToken] = 0;
                IERC20(rewardsToken).safeTransfer(msg.sender, reward);
                emit RewardPaid(msg.sender, address(rewardsToken), reward);
            }
        }
    }

    /**
     * @notice Allows a user to claim any rewards to internal balance
     */
    function getRewardAsInternalBalance() public nonReentrant updateReward(msg.sender) {
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](rewardTokens.length);

        for (uint256 i; i < rewardTokens.length; i++) {
            IERC20 rewardsToken = rewardTokens[i];
            uint256 reward = rewards[msg.sender][rewardsToken];

            if (reward > 0) {
                rewards[msg.sender][rewardsToken] = 0;

                emit RewardPaid(msg.sender, address(rewardsToken), reward);
            }

            ops[i] = IVault.UserBalanceOp({
                asset: IAsset(address(rewardsToken)),
                amount: reward,
                sender: address(this),
                recipient: msg.sender,
                kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
            });
        }
        vault.manageUserBalance(ops);
    }

    function exit() external {
        withdraw(_balances[msg.sender]);
        getReward();
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /**
     * @notice Allows a rewards distributor to deposit more tokens to be distributed as rewards
     * @param rewardsToken - the token to deposit into staking contract for distribution
     * @param reward - the amount of tokens to deposit
     */
    function notifyRewardAmount(IERC20 rewardsToken, uint256 reward) external override updateReward(address(0)) {
        require(rewardData[rewardsToken].rewardsDistributor == msg.sender, "Callable only by distributor");
        // handle the transfer of reward tokens via `transferFrom` to reduce the number
        // of transactions required and ensure correctness of the reward amount
        IERC20(rewardsToken).safeTransferFrom(msg.sender, address(this), reward);

        if (block.timestamp >= rewardData[rewardsToken].periodFinish) {
            rewardData[rewardsToken].rewardRate = reward.divDown(rewardData[rewardsToken].rewardsDuration);
        } else {
            uint256 remaining = rewardData[rewardsToken].periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mulDown(rewardData[rewardsToken].rewardRate);
            rewardData[rewardsToken].rewardRate = reward.add(leftover).divDown(
                rewardData[rewardsToken].rewardsDuration
            );
        }

        rewardData[rewardsToken].lastUpdateTime = block.timestamp;
        rewardData[rewardsToken].periodFinish = block.timestamp.add(rewardData[rewardsToken].rewardsDuration);
        emit RewardAdded(address(rewardsToken), reward);
    }

    /**
     * @notice
     * Allows the owner to recover any extra tokens sent to this address.
     * Added to support recovering LP Rewards from other systems to be distributed to holders
     * @param token - the token to recover (cannot be staking or reward token)
     * @param tokenAmount - the amount of tokens to withdraw
     */
    function recoverERC20(IERC20 token, uint256 tokenAmount) external onlyOwner {
        require(token != stakingToken, "Cannot withdraw staking token");
        require(rewardData[token].lastUpdateTime == 0, "Cannot withdraw reward token");
        token.safeTransfer(owner(), tokenAmount);
        emit Recovered(address(token), tokenAmount);
    }

    function setRewardsDuration(IERC20 rewardsToken, uint256 rewardsDuration) external {
        require(block.timestamp > rewardData[rewardsToken].periodFinish, "Reward period still active");
        require(rewardData[rewardsToken].rewardsDistributor == msg.sender, "Callable only by distributor");
        require(rewardsDuration > 0, "Reward duration must be non-zero");
        rewardData[rewardsToken].rewardsDuration = rewardsDuration;
        emit RewardsDurationUpdated(address(rewardsToken), rewardData[rewardsToken].rewardsDuration);
    }

    /* ========== MODIFIERS ========== */

    modifier updateReward(address account) {
        for (uint256 i; i < rewardTokens.length; i++) {
            IERC20 token = rewardTokens[i];
            rewardData[token].rewardPerTokenStored = rewardPerToken(token);
            rewardData[token].lastUpdateTime = lastTimeRewardApplicable(token);
            if (account != address(0)) {
                rewards[account][token] = earned(account, token);
                userRewardPerTokenPaid[account][token] = rewardData[token].rewardPerTokenStored;
            }
        }
        _;
    }

    /* ========== EVENTS ========== */

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardsDurationUpdated(address token, uint256 newDuration);
    event Recovered(address token, uint256 amount);
}
