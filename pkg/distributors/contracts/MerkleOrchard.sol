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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/MerkleProof.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAsset.sol";

import "./interfaces/IDistributor.sol";
import "./interfaces/IDistributorCallback.sol";

pragma solidity ^0.7.0;

contract MerkleOrchard {
    using SafeERC20 for IERC20;

    // Recorded distributions
    // channelId > distributor > distribution > root
    mapping(bytes32 => mapping(uint256 => bytes32)) public trees;
    // channelId > lp > distribution / 256 -> bitmap
    mapping(bytes32 => mapping(address => mapping(uint256 => uint256))) public claimedBitmap;
    // channelId > balance
    mapping(bytes32 => uint256) public suppliedBalance;

    event DistributionAdded(address indexed token, uint256 amount);
    event DistributionSent(address indexed user, address indexed token, uint256 amount);

    IVault public immutable vault;

    constructor(IVault _vault) {
        vault = _vault;
    }

    struct Claim {
        uint256 distribution;
        uint256 balance;
        address distributor;
        uint256 tokenIndex;
        bytes32[] merkleProof;
    }

    function _processClaims(
        address liquidityProvider,
        address recipient,
        Claim[] memory claims,
        IERC20[] memory tokens,
        bool asInternalBalance
    ) internal {
        uint256[] memory amounts = new uint256[](tokens.length);

        // To save gas when setting claimed statuses in storange we group updates
        // into currentBits for a particular channel, only setting them when a claim
        // on a new channel is seen, or on the final iteration

        // for aggregating claims
        uint256 currentBits;
        bytes32 currentChannelId;
        uint256 currentWordIndex;
        uint256 currentClaimAmount;

        Claim memory claim;
        for (uint256 i = 0; i < claims.length; i++) {
            claim = claims[i];

            // When we process a new claim we either
            // a) aggregate the new claim bit with previous claims of the same channel/claim bitmap
            // b) set claim status and start aggregating a new set of currentBits for a new channel/word
            if (currentChannelId == bytes32(0)) {
                currentChannelId = keccak256(abi.encodePacked(address(tokens[claim.tokenIndex]), claim.distributor));
                currentWordIndex = claim.distribution / 256;
                currentBits = 1 << claim.distribution % 256;
                currentClaimAmount = claim.balance;
            } else if (
                currentChannelId == keccak256(abi.encodePacked(address(tokens[claim.tokenIndex]), claim.distributor))
            ) {
                if (currentWordIndex == claim.distribution / 256) {
                    currentBits |= 1 << claim.distribution % 256;
                    currentClaimAmount += claim.balance;
                } else {
                    _setClaimedBits(liquidityProvider, currentChannelId, currentWordIndex, currentBits);

                    currentWordIndex = claim.distribution / 256;
                    currentBits = 1 << claim.distribution % 256;
                }
            } else {
                _setClaimedBits(liquidityProvider, currentChannelId, currentWordIndex, currentBits);
                _deductClaimedBalance(currentChannelId, currentClaimAmount);

                currentChannelId = keccak256(abi.encodePacked(address(tokens[claim.tokenIndex]), claim.distributor));
                currentClaimAmount = claim.balance;
                currentBits = 1 << claim.distribution % 256;
            }

            if (i == claims.length - 1) {
                _setClaimedBits(liquidityProvider, currentChannelId, currentWordIndex, currentBits);
                _deductClaimedBalance(currentChannelId, currentClaimAmount);
            }

            require(
                _verifyClaim(currentChannelId, liquidityProvider, claim.distribution, claim.balance, claim.merkleProof),
                "Incorrect merkle proof"
            );

            amounts[claim.tokenIndex] += claim.balance;
        }

        IVault.UserBalanceOpKind kind = asInternalBalance
            ? IVault.UserBalanceOpKind.TRANSFER_INTERNAL
            : IVault.UserBalanceOpKind.WITHDRAW_INTERNAL;
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            ops[i] = IVault.UserBalanceOp({
                asset: IAsset(address(tokens[i])),
                amount: amounts[i],
                sender: address(this),
                recipient: payable(recipient),
                kind: kind
            });
            emit DistributionSent(recipient, address(tokens[i]), amounts[i]);
        }
        vault.manageUserBalance(ops);
    }

    /**
     * @notice Allows a user to claim multiple distributions
     */
    function claimDistributions(
        address liquidityProvider,
        Claim[] memory claims,
        IERC20[] memory tokens
    ) external {
        require(msg.sender == liquidityProvider, "user must claim own balance");

        _processClaims(liquidityProvider, msg.sender, claims, tokens, false);
    }

    /**
     * @notice Allows a user to claim multiple distributions to internal balance
     */
    function claimDistributionsToInternalBalance(
        address liquidityProvider,
        Claim[] memory claims,
        IERC20[] memory tokens
    ) external {
        require(msg.sender == liquidityProvider, "user must claim own balance");

        _processClaims(liquidityProvider, msg.sender, claims, tokens, true);
    }

    /**
     * @notice Allows a user to claim several distributions to a callback
     */
    function claimDistributionsWithCallback(
        address liquidityProvider,
        IDistributorCallback callbackContract,
        bytes calldata callbackData,
        Claim[] memory claims,
        IERC20[] memory tokens
    ) external {
        require(msg.sender == liquidityProvider, "user must claim own balance");
        _processClaims(liquidityProvider, address(callbackContract), claims, tokens, true);
        callbackContract.distributorCallback(callbackData);
    }

    function isClaimed(
        IERC20 token,
        address distributor,
        uint256 distribution,
        address liquidityProvider
    ) public view returns (bool) {
        uint256 distributionWordIndex = distribution / 256;
        uint256 distributionBitIndex = distribution % 256;

        bytes32 channelId = keccak256(abi.encodePacked(token, distributor));
        return (claimedBitmap[channelId][liquidityProvider][distributionWordIndex] & (1 << distributionBitIndex)) != 0;
    }

    function _setClaimedBits(
        address liquidityProvider,
        bytes32 channelId,
        uint256 wordIndex,
        uint256 newClaimsBitmap
    ) private {
        require((newClaimsBitmap & claimedBitmap[channelId][liquidityProvider][wordIndex]) == 0, "cannot claim twice");
        claimedBitmap[channelId][liquidityProvider][wordIndex] |= newClaimsBitmap;
    }

    function _deductClaimedBalance(bytes32 channelId, uint256 balanceBeingClaimed) private {
        require(
            suppliedBalance[channelId] >= balanceBeingClaimed,
            "distributor hasn't provided sufficient tokens for claim"
        );
        suppliedBalance[channelId] -= balanceBeingClaimed;
    }

    function claimStatus(
        address liquidityProvider,
        IERC20 token,
        address distributor,
        uint256 begin,
        uint256 end
    ) external view returns (bool[] memory) {
        require(begin <= end, "distributions must be specified in ascending order");
        uint256 size = 1 + end - begin;
        bool[] memory arr = new bool[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = isClaimed(token, distributor, begin + i, liquidityProvider);
        }
        return arr;
    }

    function merkleRoots(
        IERC20 token,
        address distributor,
        uint256 begin,
        uint256 end
    ) external view returns (bytes32[] memory) {
        bytes32 channelId = keccak256(abi.encodePacked(token, distributor));
        require(begin <= end, "distributions must be specified in ascending order");
        uint256 size = 1 + end - begin;
        bytes32[] memory arr = new bytes32[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = trees[channelId][begin + i];
        }
        return arr;
    }

    function _verifyClaim(
        bytes32 channelId,
        address liquidityProvider,
        uint256 distribution,
        uint256 claimedBalance,
        bytes32[] memory merkleProof
    ) internal view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(liquidityProvider, claimedBalance));
        return MerkleProof.verify(merkleProof, trees[channelId][distribution], leaf);
    }

    function verifyClaim(
        IERC20 token,
        address distributor,
        address liquidityProvider,
        uint256 distribution,
        uint256 claimedBalance,
        bytes32[] memory merkleProof
    ) public view returns (bool) {
        bytes32 channelId = keccak256(abi.encodePacked(token, distributor));
        return _verifyClaim(channelId, liquidityProvider, distribution, claimedBalance, merkleProof);
    }

    /**
     * @notice
     * Allows a distributor to add funds to the contract as a merkle tree, These tokens will
     * be withdrawn from the sender
     * These will be pulled from the user
     */
    function createDistribution(
        IERC20 token,
        uint256 distribution,
        bytes32 merkleRoot,
        uint256 amount
    ) external {
        bytes32 channelId = keccak256(abi.encodePacked(token, msg.sender));
        require(trees[channelId][distribution] == bytes32(0), "cannot rewrite merkle root");
        token.safeTransferFrom(msg.sender, address(this), amount);

        token.approve(address(vault), type(uint256).max);
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);

        ops[0] = IVault.UserBalanceOp({
            asset: IAsset(address(token)),
            amount: amount,
            sender: address(this),
            recipient: payable(address(this)),
            kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
        });

        vault.manageUserBalance(ops);

        suppliedBalance[channelId] += amount;
        trees[channelId][distribution] = merkleRoot;
        emit DistributionAdded(address(token), amount);
    }
}
