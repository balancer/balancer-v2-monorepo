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
    //IERC20 public immutable stakingToken;
    mapping(IERC20 => mapping(IERC20 => Reward)) public rewardData;
    mapping(IERC20 => IERC20[]) public rewardTokens;

    // stakingToken -> user -> reward token -> amount
    mapping(IERC20 => mapping(address => mapping(IERC20 => uint256))) public userRewardPerTokenPaid;
    mapping(IERC20 => mapping(address => mapping(IERC20 => uint256))) public rewards;

    mapping(IERC20 => uint256) private _totalSupply;
    mapping(IERC20 => mapping(address => uint256)) private _balances;

    /* ========== CONSTRUCTOR ========== */

    constructor(IVault _vault) Ownable() TemporarilyPausable(3600, 3600) {
        vault = _vault;
    }

    /**
     * @notice Adds a new reward token to be distributed
     * @param rewardsToken - The new token to be distributed to stakers
     * @param rewardsDistributor - The address which is designated to add `rewardsToken` to be distributed
     * @param rewardsDuration - The duration over which each distribution is spread
     */
    function addReward(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        address rewardsDistributor,
        uint256 rewardsDuration
    ) public onlyOwner {
        require(rewardsDuration > 0, "reward rate must be nonzero");
        require(rewardData[stakingToken][rewardsToken].rewardsDuration == 0, "Duplicate rewards token");
        rewardTokens[stakingToken].push(rewardsToken);
        rewardData[stakingToken][rewardsToken].rewardsDistributor = rewardsDistributor;
        rewardData[stakingToken][rewardsToken].rewardsDuration = rewardsDuration;
        rewardsToken.approve(address(vault), type(uint256).max);
    }

    /* ========== VIEWS ========== */

    function totalSupply(IERC20 stakingToken) external view returns (uint256) {
        return _totalSupply[stakingToken];
    }

    function balanceOf(IERC20 stakingToken, address account) external view returns (uint256) {
        return _balances[stakingToken][account];
    }

    function lastTimeRewardApplicable(IERC20 stakingToken, IERC20 rewardsToken) public view returns (uint256) {
        return Math.min(block.timestamp, rewardData[stakingToken][rewardsToken].periodFinish);
    }

    function rewardPerToken(IERC20 stakingToken, IERC20 rewardsToken) public view returns (uint256) {
        if (_totalSupply[stakingToken] == 0) {
            return rewardData[stakingToken][rewardsToken].rewardPerTokenStored;
        }
        return
            rewardData[stakingToken][rewardsToken].rewardPerTokenStored.add(
                lastTimeRewardApplicable(stakingToken, rewardsToken)
                    .sub(rewardData[stakingToken][rewardsToken].lastUpdateTime)
                    .mulDown(rewardData[stakingToken][rewardsToken].rewardRate)
                    .mulDown(1e18)
                    .divDown(_totalSupply[stakingToken])
            );
    }

    /**
     * @notice Calculates the amount of `rewardsToken` that `account` is able to claim
     */
    function earned(
        IERC20 stakingToken,
        address account,
        IERC20 rewardsToken
    ) public view returns (uint256) {
        return
            _balances[stakingToken][account]
                .mulDown(
                rewardPerToken(stakingToken, rewardsToken).sub(
                    userRewardPerTokenPaid[stakingToken][account][rewardsToken]
                )
            )
                .divDown(1e18)
                .add(rewards[stakingToken][account][rewardsToken]);
    }

    function getRewardForDuration(IERC20 stakingToken, IERC20 rewardsToken) external view returns (uint256) {
        return
            rewardData[stakingToken][rewardsToken].rewardRate.mulDown(
                rewardData[stakingToken][rewardsToken].rewardsDuration
            );
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function setRewardsDistributor(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        address rewardsDistributor
    ) external onlyOwner {
        rewardData[stakingToken][rewardsToken].rewardsDistributor = rewardsDistributor;
    }

    function stake(IERC20 stakingToken, uint256 amount) external {
        stake(stakingToken, amount, msg.sender);
    }

    function stake(
        IERC20 stakingToken,
        uint256 amount,
        address receiver
    ) public nonReentrant whenNotPaused updateReward(stakingToken, receiver) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply[stakingToken] = _totalSupply[stakingToken].add(amount);
        _balances[stakingToken][receiver] = _balances[stakingToken][receiver].add(amount);
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(address(stakingToken), receiver, amount);
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
        IERC20 stakingToken,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        IERC20Permit(address(stakingToken)).permit(msg.sender, address(this), amount, deadline, v, r, s);
        stake(stakingToken, amount, msg.sender);
    }

    function withdraw(IERC20 stakingToken, uint256 amount) public nonReentrant updateReward(stakingToken, msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply[stakingToken] = _totalSupply[stakingToken].sub(amount);
        _balances[stakingToken][msg.sender] = _balances[stakingToken][msg.sender].sub(amount);
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(address(stakingToken), msg.sender, amount);
    }

    function getReward(IERC20[] calldata stakingTokens) public nonReentrant {
        _getReward(stakingTokens, false);
    }

    function getRewardAsInternalBalance(IERC20[] calldata stakingTokens) public nonReentrant {
        _getReward(stakingTokens, true);
    }

    /**
     * @notice Allows a user to claim any rewards to internal balance
     */
    function _getReward(IERC20[] calldata stakingTokens, bool asInternalBalance) internal {
        IVault.UserBalanceOpKind kind = asInternalBalance
            ? IVault.UserBalanceOpKind.TRANSFER_INTERNAL
            : IVault.UserBalanceOpKind.WITHDRAW_INTERNAL;

        uint256 opsCount;
        for (uint256 k; k < stakingTokens.length; k++) {
            IERC20 stakingToken = stakingTokens[k];
            opsCount += rewardTokens[stakingToken].length;
        }

        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](opsCount);

        uint256 idx;
        for (uint256 j; j < stakingTokens.length; j++) {
            IERC20 stakingToken = stakingTokens[j];
            for (uint256 i; i < rewardTokens[stakingToken].length; i++) {
                IERC20 rewardsToken = rewardTokens[stakingToken][i];
                _updateReward(stakingToken, msg.sender, rewardsToken);
                uint256 reward = rewards[stakingToken][msg.sender][rewardsToken];

                if (reward > 0) {
                    rewards[stakingToken][msg.sender][rewardsToken] = 0;

                    emit RewardPaid(msg.sender, address(rewardsToken), reward);
                }

                ops[idx] = IVault.UserBalanceOp({
                    asset: IAsset(address(rewardsToken)),
                    amount: reward,
                    sender: address(this),
                    recipient: msg.sender,
                    kind: kind
                });
                idx++;
            }
        }
        vault.manageUserBalance(ops);
    }

    function exit(IERC20[] calldata stakingTokens) external {
        for (uint256 j; j < stakingTokens.length; j++) {
            IERC20 stakingToken = stakingTokens[j];
            withdraw(stakingToken, _balances[stakingToken][msg.sender]);
        }
        getReward(stakingTokens);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /**
     * @notice Allows a rewards distributor to deposit more tokens to be distributed as rewards
     * @param rewardsToken - the token to deposit into staking contract for distribution
     * @param reward - the amount of tokens to deposit
     */
    function notifyRewardAmount(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        uint256 reward
    ) external override updateReward(stakingToken, address(0)) {
        require(
            rewardData[stakingToken][rewardsToken].rewardsDistributor == msg.sender,
            "Callable only by distributor"
        );
        // handle the transfer of reward tokens via `safeTransactionFrom` to reduce the number
        // of transactions required and ensure correctness of the reward amount
        rewardsToken.safeTransferFrom(msg.sender, address(this), reward);

        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);

        ops[0] = IVault.UserBalanceOp({
            asset: IAsset(address(rewardsToken)),
            amount: reward,
            sender: address(this),
            recipient: payable(address(this)),
            kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
        });

        vault.manageUserBalance(ops);

        if (block.timestamp >= rewardData[stakingToken][rewardsToken].periodFinish) {
            rewardData[stakingToken][rewardsToken].rewardRate = reward.divDown(
                rewardData[stakingToken][rewardsToken].rewardsDuration
            );
        } else {
            uint256 remaining = rewardData[stakingToken][rewardsToken].periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mulDown(rewardData[stakingToken][rewardsToken].rewardRate);
            rewardData[stakingToken][rewardsToken].rewardRate = reward.add(leftover).divDown(
                rewardData[stakingToken][rewardsToken].rewardsDuration
            );
        }

        rewardData[stakingToken][rewardsToken].lastUpdateTime = block.timestamp;
        rewardData[stakingToken][rewardsToken].periodFinish = block.timestamp.add(
            rewardData[stakingToken][rewardsToken].rewardsDuration
        );
        emit RewardAdded(address(rewardsToken), reward);
    }

    /**
     * @notice
     * Allows the owner to recover any extra tokens sent to this address.
     * Added to support recovering LP Rewards from other systems to be distributed to holders
     * @param token - the token to recover (cannot be staking or reward token)
     * @param tokenAmount - the amount of tokens to withdraw
     */
    function recoverERC20(
        IERC20 stakingToken,
        IERC20 token,
        uint256 tokenAmount
    ) external onlyOwner {
        require(token != stakingToken, "Cannot withdraw staking token");
        // TODO
        require(rewardData[stakingToken][token].lastUpdateTime == 0, "Cannot withdraw reward token");

        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);
        ops[0] = IVault.UserBalanceOp({
            asset: IAsset(address(token)),
            amount: tokenAmount,
            sender: address(this),
            recipient: payable(owner()),
            kind: IVault.UserBalanceOpKind.TRANSFER_EXTERNAL
        });

        vault.manageUserBalance(ops);

        emit Recovered(address(token), tokenAmount);
    }

    function setRewardsDuration(
        IERC20 stakingToken,
        IERC20 rewardsToken,
        uint256 rewardsDuration
    ) external {
        require(block.timestamp > rewardData[stakingToken][rewardsToken].periodFinish, "Reward period still active");
        require(
            rewardData[stakingToken][rewardsToken].rewardsDistributor == msg.sender,
            "Callable only by distributor"
        );
        require(rewardsDuration > 0, "Reward duration must be non-zero");
        rewardData[stakingToken][rewardsToken].rewardsDuration = rewardsDuration;
        emit RewardsDurationUpdated(
            address(stakingToken),
            address(rewardsToken),
            rewardData[stakingToken][rewardsToken].rewardsDuration
        );
    }

    function _updateReward(
        IERC20 stakingToken,
        address account,
        IERC20 token
    ) internal {
        rewardData[stakingToken][token].rewardPerTokenStored = rewardPerToken(stakingToken, token);
        rewardData[stakingToken][token].lastUpdateTime = lastTimeRewardApplicable(stakingToken, token);
        if (account != address(0)) {
            rewards[stakingToken][account][token] = earned(stakingToken, account, token);
            userRewardPerTokenPaid[stakingToken][account][token] = rewardData[stakingToken][token].rewardPerTokenStored;
        }
    }

    /* ========== MODIFIERS ========== */

    modifier updateReward(IERC20 stakingToken, address account) {
        for (uint256 i; i < rewardTokens[stakingToken].length; i++) {
            IERC20 rewardToken = rewardTokens[stakingToken][i];
            _updateReward(stakingToken, account, rewardToken);
        }
        _;
    }

    /* ========== EVENTS ========== */

    event Staked(address indexed stakingToken, address indexed user, uint256 amount);
    event Withdrawn(address indexed stakingToken, address indexed user, uint256 amount);
    event RewardsDurationUpdated(address indexed stakingToken, address token, uint256 newDuration);
    event Recovered(address indexed token, uint256 amount);
}
