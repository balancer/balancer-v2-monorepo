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

contract MerkleOrchard is IDistributor {
    using SafeERC20 for IERC20;

    // Recorded distributions
    // token > distributor > distribution > root
    mapping(IERC20 => mapping(address => mapping(uint256 => bytes32))) public trees;
    // token > distributor distribution > lp > root
    mapping(IERC20 => mapping(address => mapping(uint256 => mapping(address => bool)))) public claimed;
    // token > distributor > balance
    mapping(IERC20 => mapping(address => uint256)) public suppliedBalance;

    event RewardAdded(address indexed token, uint256 amount);

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

        Claim memory claim;
        IERC20 token;
        for (uint256 i = 0; i < claims.length; i++) {
            claim = claims[i];
            token = tokens[claim.tokenIndex];

            require(!isClaimed(token, claim.distributor, claim.distribution, liquidityProvider), "cannot claim twice");
            require(
                verifyClaim(
                    token,
                    claim.distributor,
                    liquidityProvider,
                    claim.distribution,
                    claim.balance,
                    claim.merkleProof
                ),
                "Incorrect merkle proof"
            );

            require(
                suppliedBalance[token][claim.distributor] >= claim.balance,
                "distributor hasn't provided sufficient tokens for claim"
            );

            claimed[token][claim.distributor][claim.distribution][liquidityProvider] = true;

            amounts[claim.tokenIndex] += claim.balance;

            suppliedBalance[token][claim.distributor] = suppliedBalance[token][claim.distributor] - claim.balance;
            emit RewardPaid(recipient, address(token), claim.balance);
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
        return claimed[token][distributor][distribution][liquidityProvider];
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
        require(begin <= end, "distributions must be specified in ascending order");
        uint256 size = 1 + end - begin;
        bytes32[] memory arr = new bytes32[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = trees[token][distributor][begin + i];
        }
        return arr;
    }

    function verifyClaim(
        IERC20 token,
        address distributor,
        address liquidityProvider,
        uint256 distribution,
        uint256 claimedBalance,
        bytes32[] memory merkleProof
    ) public view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(liquidityProvider, claimedBalance));
        return MerkleProof.verify(merkleProof, trees[token][distributor][distribution], leaf);
    }

    /**
     * @notice
     * Allows a rewarder to add funds to the contract as a merkle tree, These tokens will
     * be withdrawn from the sender
     * These will be pulled from the user
     */
    function seedAllocations(
        IERC20 token,
        uint256 distribution,
        bytes32 _merkleRoot,
        uint256 amount
    ) external {
        require(trees[token][msg.sender][distribution] == bytes32(0), "cannot rewrite merkle root");
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

        suppliedBalance[token][msg.sender] = suppliedBalance[token][msg.sender] + amount;
        trees[token][msg.sender][distribution] = _merkleRoot;
        emit RewardAdded(address(token), amount);
    }
}
