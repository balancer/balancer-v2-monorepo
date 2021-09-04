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

pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/MerkleProof.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAsset.sol";

import "./interfaces/IDistributor.sol";
import "./interfaces/IDistributorCallback.sol";

pragma solidity ^0.7.0;

contract MerkleOrchard is IDistributor, Ownable {
    using FixedPoint for uint256;
    using SafeERC20 for IERC20;

    // Recorded distributions
    // keccak(rewardToken|rewarder|distribution) > root
    mapping(bytes32 => bytes32) public trees;
    // keccak(rewardToken|rewarder|distribution) > lp > claimStatus
    mapping(bytes32 => mapping(address => bool)) public claimed;
    // rewardToken > rewarder > balance
    mapping(IERC20 => mapping(address => uint256)) public suppliedBalance;

    IVault public immutable vault;

    constructor(IVault _vault) {
        vault = _vault;
    }

    struct Claim {
        uint256 distribution;
        uint256 balance;
        address rewarder;
        IERC20 rewardToken;
        bytes32[] merkleProof;
    }

    function _processClaims(
        address liquidityProvider,
        address recipient,
        Claim[] memory claims,
        bool asInternalBalance
    ) internal {
        // We want to keep track of the number of unique tokens so we can aggregate transfers
        uint256 numRewardTokens;
        IERC20[] memory rewardTokens = new IERC20[](claims.length);
        uint256[] memory rewardAmounts = new uint256[](claims.length);

        Claim memory claim;
        for (uint256 i = 0; i < claims.length; i++) {
            claim = claims[i];
            bytes32 distributionId = _getDistributionId(claim.rewardToken, claim.rewarder, claim.distribution);

            require(!_isClaimed(distributionId, liquidityProvider), "cannot claim twice");
            _setClaimed(distributionId, liquidityProvider);

            require(
                _verifyClaim(distributionId, liquidityProvider, claim.balance, claim.merkleProof),
                "Incorrect merkle proof"
            );

            require(
                suppliedBalance[claim.rewardToken][claim.rewarder] >= claim.balance,
                "rewarder hasn't provided sufficient rewardTokens for claim"
            );
            suppliedBalance[claim.rewardToken][claim.rewarder] -= claim.balance;

            // Iterate through all the reward tokens we've seen so far.
            for (uint256 j = 0; j < rewardTokens.length; i++) {
                // Check if we're already sending some of this token
                // If so we just want to add to the existing transfer
                if (rewardTokens[j] == claim.rewardToken) {
                    rewardAmounts[j] += claim.balance;
                    break;
                } else if (rewardTokens[j] == IERC20(0)) {
                    // If it's the first time we've seen this token
                    // record both its address and amount to transfer
                    rewardTokens[j] = claim.rewardToken;
                    rewardAmounts[j] = claim.balance;
                    numRewardTokens += 1;
                    break;
                }
            }

            emit RewardPaid(recipient, address(claim.rewardToken), claim.balance);
        }

        IVault.UserBalanceOpKind kind = asInternalBalance
            ? IVault.UserBalanceOpKind.TRANSFER_INTERNAL
            : IVault.UserBalanceOpKind.WITHDRAW_INTERNAL;
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](numRewardTokens);

        for (uint256 i = 0; i < numRewardTokens; i++) {
            ops[i] = IVault.UserBalanceOp({
                asset: IAsset(address(rewardTokens[i])),
                amount: rewardAmounts[i],
                sender: address(this),
                recipient: payable(recipient),
                kind: kind
            });
        }
        vault.manageUserBalance(ops);
    }

    /**
     * @notice Allows a user to claim multiple distributions of reward
     */
    function claimDistributions(address liquidityProvider, Claim[] memory claims) external {
        require(msg.sender == liquidityProvider, "user must claim own balance");

        _processClaims(liquidityProvider, msg.sender, claims, false);
    }

    /**
     * @notice Allows a user to claim multiple distributions of reward to internal balance
     */
    function claimDistributionsToInternalBalance(address liquidityProvider, Claim[] memory claims) external {
        require(msg.sender == liquidityProvider, "user must claim own balance");

        _processClaims(liquidityProvider, msg.sender, claims, true);
    }

    /**
     * @notice Allows a user to claim several distributions of rewards to a callback
     */
    function claimDistributionsWithCallback(
        address liquidityProvider,
        Claim[] memory claims,
        IDistributorCallback callbackContract,
        bytes calldata callbackData
    ) external {
        require(msg.sender == liquidityProvider, "user must claim own balance");
        _processClaims(liquidityProvider, address(callbackContract), claims, true);
        callbackContract.distributorCallback(callbackData);
    }

    function isClaimed(
        IERC20 rewardToken,
        address rewarder,
        uint256 distribution,
        address liquidityProvider
    ) public view returns (bool) {
        return _isClaimed(_getDistributionId(rewardToken, rewarder, distribution), liquidityProvider);
    }

    function _isClaimed(bytes32 distributionId, address liquidityProvider) internal view returns (bool) {
        return claimed[distributionId][liquidityProvider];
    }

    function _setClaimed(bytes32 distributionId, address liquidityProvider) internal {
        claimed[distributionId][liquidityProvider] = true;
    }

    function claimStatus(
        address liquidityProvider,
        IERC20 rewardToken,
        address rewarder,
        uint256 begin,
        uint256 end
    ) external view returns (bool[] memory) {
        require(begin <= end, "distributions must be specified in ascending order");
        uint256 size = 1 + end - begin;
        bool[] memory arr = new bool[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = isClaimed(rewardToken, rewarder, begin + i, liquidityProvider);
        }
        return arr;
    }

    function merkleRoots(
        IERC20 rewardToken,
        address rewarder,
        uint256 begin,
        uint256 end
    ) external view returns (bytes32[] memory) {
        require(begin <= end, "distributions must be specified in ascending order");
        uint256 size = 1 + end - begin;
        bytes32[] memory arr = new bytes32[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = trees[_getDistributionId(rewardToken, rewarder, begin + i)];
        }
        return arr;
    }

    function verifyClaim(
        IERC20 rewardToken,
        address rewarder,
        uint256 distribution,
        address liquidityProvider,
        uint256 claimedBalance,
        bytes32[] memory merkleProof
    ) public view returns (bool) {
        bytes32 distributionId = _getDistributionId(rewardToken, rewarder, distribution);
        return _verifyClaim(distributionId, liquidityProvider, claimedBalance, merkleProof);
    }

    function _verifyClaim(
        bytes32 distributionId,
        address liquidityProvider,
        uint256 claimedBalance,
        bytes32[] memory merkleProof
    ) internal view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(liquidityProvider, claimedBalance));
        return MerkleProof.verify(merkleProof, trees[distributionId], leaf);
    }

    function _getDistributionId(
        IERC20 rewardToken,
        address rewarder,
        uint256 distribution
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(rewardToken, rewarder, distribution));
    }

    /**
     * @notice
     * Allows the owner to add funds to the contract as a merkle tree, These tokens will
     * be withdrawn from the sender
     * These will be pulled from the user
     */
    function seedAllocations(
        IERC20 rewardToken,
        uint256 distribution,
        bytes32 _merkleRoot,
        uint256 amount
    ) external {
        bytes32 distributionId = _getDistributionId(rewardToken, msg.sender, distribution);
        require(trees[distributionId] == bytes32(0), "cannot rewrite merkle root");
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);

        rewardToken.approve(address(vault), type(uint256).max);
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);

        ops[0] = IVault.UserBalanceOp({
            asset: IAsset(address(rewardToken)),
            amount: amount,
            sender: address(this),
            recipient: payable(address(this)),
            kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
        });

        vault.manageUserBalance(ops);

        suppliedBalance[rewardToken][msg.sender] += amount;
        trees[distributionId] = _merkleRoot;
        emit RewardAdded(address(rewardToken), amount);
    }
}
