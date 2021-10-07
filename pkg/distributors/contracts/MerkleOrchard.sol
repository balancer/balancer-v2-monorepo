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

import "./interfaces/IDistributorCallback.sol";

pragma solidity ^0.7.0;

contract MerkleOrchard {
    using SafeERC20 for IERC20;

    // Recorded treeIds
    // groveId > treeId > merkle root
    mapping(bytes32 => mapping(uint256 => bytes32)) private _tree;
    // groveId > claimer > treeId / 256 -> bitmap
    mapping(bytes32 => mapping(address => mapping(uint256 => uint256))) private _claimedBitmap;
    // groveId > balance
    mapping(bytes32 => uint256) private _suppliedBalance;

    event DistributionAdded(
        address indexed distributor,
        address indexed token,
        uint256 treeId,
        bytes32 merkleRoot,
        uint256 amount
    );
    event DistributionClaimed(
        address indexed distributor,
        address indexed token,
        uint256 treeId,
        address indexed claimer,
        address recipient,
        uint256 amount
    );

    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    struct Claim {
        uint256 treeId;
        uint256 balance;
        address distributor;
        uint256 tokenIndex;
        bytes32[] merkleProof;
    }

    // Getters

    function getVault() public view returns (IVault) {
        return _vault;
    }

    function getDistributionRoot(
        IERC20 token,
        address distributor,
        uint256 treeId
    ) external view returns (bytes32) {
        bytes32 groveId = _getGroveId(token, distributor);
        return _tree[groveId][treeId];
    }

    function getSuppliedBalance(IERC20 token, address distributor) external view returns (uint256) {
        bytes32 groveId = _getGroveId(token, distributor);
        return _suppliedBalance[groveId];
    }

    function isClaimed(
        IERC20 token,
        address distributor,
        uint256 treeId,
        address claimer
    ) public view returns (bool) {
        uint256 treeIdWordIndex = treeId / 256;
        uint256 treeIdBitIndex = treeId % 256;

        bytes32 groveId = _getGroveId(token, distributor);
        return (_claimedBitmap[groveId][claimer][treeIdWordIndex] & (1 << treeIdBitIndex)) != 0;
    }

    function claimStatus(
        IERC20 token,
        address distributor,
        address claimer,
        uint256 begin,
        uint256 end
    ) external view returns (bool[] memory) {
        require(begin <= end, "treeIds must be specified in ascending order");
        uint256 size = 1 + end - begin;
        bool[] memory arr = new bool[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = isClaimed(token, distributor, begin + i, claimer);
        }
        return arr;
    }

    function merkleRoots(
        IERC20 token,
        address distributor,
        uint256 begin,
        uint256 end
    ) external view returns (bytes32[] memory) {
        bytes32 groveId = _getGroveId(token, distributor);
        require(begin <= end, "treeIds must be specified in ascending order");
        uint256 size = 1 + end - begin;
        bytes32[] memory arr = new bytes32[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = _tree[groveId][begin + i];
        }
        return arr;
    }

    function verifyClaim(
        IERC20 token,
        address distributor,
        uint256 treeId,
        address claimer,
        uint256 claimedBalance,
        bytes32[] memory merkleProof
    ) external view returns (bool) {
        bytes32 groveId = _getGroveId(token, distributor);
        return _verifyClaim(groveId, treeId, claimer, claimedBalance, merkleProof);
    }

    // Claim functions

    /**
     * @notice Allows a user to claim from multiple trees
     */
    function claimDistributions(
        address claimer,
        Claim[] memory claims,
        IERC20[] memory tokens
    ) external {
        require(msg.sender == claimer, "user must claim own balance");

        _processClaims(claimer, msg.sender, claims, tokens, false);
    }

    /**
     * @notice Allows a user to claim multiple distributions to internal balance
     */
    function claimDistributionsToInternalBalance(
        address claimer,
        Claim[] memory claims,
        IERC20[] memory tokens
    ) external {
        require(msg.sender == claimer, "user must claim own balance");

        _processClaims(claimer, msg.sender, claims, tokens, true);
    }

    /**
     * @notice Allows a user to claim several distributions to a callback
     */
    function claimDistributionsWithCallback(
        address claimer,
        Claim[] memory claims,
        IERC20[] memory tokens,
        IDistributorCallback callbackContract,
        bytes calldata callbackData
    ) external {
        require(msg.sender == claimer, "user must claim own balance");
        _processClaims(claimer, address(callbackContract), claims, tokens, true);
        callbackContract.distributorCallback(callbackData);
    }

    /**
     * @notice
     * Allows a distributor to add funds to the contract as a merkle tree, These tokens will
     * be withdrawn from the sender
     * These will be pulled from the user
     */
    function createDistribution(
        IERC20 token,
        uint256 treeId,
        bytes32 merkleRoot,
        uint256 amount
    ) external {
        bytes32 groveId = _getGroveId(token, msg.sender);
        require(_tree[groveId][treeId] == bytes32(0), "cannot rewrite merkle root");
        token.safeTransferFrom(msg.sender, address(this), amount);

        token.approve(address(getVault()), type(uint256).max);
        IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);

        ops[0] = IVault.UserBalanceOp({
            asset: IAsset(address(token)),
            amount: amount,
            sender: address(this),
            recipient: payable(address(this)),
            kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
        });

        getVault().manageUserBalance(ops);

        _suppliedBalance[groveId] += amount;
        _tree[groveId][treeId] = merkleRoot;
        emit DistributionAdded(msg.sender, address(token), treeId, merkleRoot, amount);
    }

    // Helper functions

    function _getGroveId(IERC20 token, address distributor) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(address(token), distributor));
    }

    function _processClaims(
        address claimer,
        address recipient,
        Claim[] memory claims,
        IERC20[] memory tokens,
        bool asInternalBalance
    ) internal {
        uint256[] memory amounts = new uint256[](tokens.length);

        // To save gas when setting claimed statuses in storage we group updates
        // into currentBits for a particular grove, only setting them when a claim
        // on a new grove is seen, or on the final iteration

        // for aggregating claims
        uint256 currentBits;
        bytes32 currentGroveId;
        uint256 currentWordIndex;
        uint256 currentClaimAmount;

        Claim memory claim;
        for (uint256 i = 0; i < claims.length; i++) {
            claim = claims[i];

            // When we process a new claim we either
            // a) aggregate the new claim bit with previous claims of the same grove/claim bitmap
            // b) set claim status and start aggregating a new set of currentBits for a new grove/word
            if (currentGroveId == _getGroveId(tokens[claim.tokenIndex], claim.distributor)) {
                if (currentWordIndex == claim.treeId / 256) {
                    currentBits |= 1 << claim.treeId % 256;
                } else {
                    _setClaimedBits(currentGroveId, claimer, currentWordIndex, currentBits);

                    currentWordIndex = claim.treeId / 256;
                    currentBits = 1 << claim.treeId % 256;
                }
                currentClaimAmount += claim.balance;
            } else {
                if (currentGroveId != bytes32(0)) {
                    _setClaimedBits(currentGroveId, claimer, currentWordIndex, currentBits);
                    _deductClaimedBalance(currentGroveId, currentClaimAmount);
                }

                currentGroveId = _getGroveId(tokens[claim.tokenIndex], claim.distributor);
                currentWordIndex = claim.treeId / 256;
                currentClaimAmount = claim.balance;
                currentBits = 1 << claim.treeId % 256;
            }

            if (i == claims.length - 1) {
                _setClaimedBits(currentGroveId, claimer, currentWordIndex, currentBits);
                _deductClaimedBalance(currentGroveId, currentClaimAmount);
            }

            require(
                _verifyClaim(currentGroveId, claim.treeId, claimer, claim.balance, claim.merkleProof),
                "incorrect merkle proof"
            );

            amounts[claim.tokenIndex] += claim.balance;
            emit DistributionClaimed(
                claim.distributor,
                address(tokens[claim.tokenIndex]),
                claim.treeId,
                claimer,
                recipient,
                claim.balance
            );
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
        getVault().manageUserBalance(ops);
    }

    /**
     * @dev Sets the bits set in `newClaimsBitmap` for the corresponding distribution.
     */
    function _setClaimedBits(
        bytes32 groveId,
        address claimer,
        uint256 wordIndex,
        uint256 newClaimsBitmap
    ) private {
        uint256 currentBitmap = _claimedBitmap[groveId][claimer][wordIndex];

        // All newly set bits must not have been previously set
        require((newClaimsBitmap & currentBitmap) == 0, "cannot claim twice");

        _claimedBitmap[groveId][claimer][wordIndex] = currentBitmap | newClaimsBitmap;
    }

    function _deductClaimedBalance(bytes32 groveId, uint256 balanceBeingClaimed) private {
        require(
            _suppliedBalance[groveId] >= balanceBeingClaimed,
            "distributor hasn't provided sufficient tokens for claim"
        );
        _suppliedBalance[groveId] -= balanceBeingClaimed;
    }

    function _verifyClaim(
        bytes32 groveId,
        uint256 treeId,
        address claimer,
        uint256 claimedBalance,
        bytes32[] memory merkleProof
    ) internal view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(claimer, claimedBalance));
        return MerkleProof.verify(merkleProof, _tree[groveId][treeId], leaf);
    }
}
