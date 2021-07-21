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
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/MerkleProof.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAsset.sol";

import "./interfaces/IDistributor.sol";

pragma solidity ^0.7.0;

contract MerkleRedeem is IDistributor, Ownable {
    using FixedPoint for uint256;
    using SafeERC20 for IERC20;

    IERC20 public immutable rewardToken;

    // Recorded weeks
    mapping(uint256 => bytes32) public weekMerkleRoots;
    mapping(uint256 => mapping(address => bool)) public claimed;

    IVault public immutable vault;

    constructor(IVault _vault, IERC20 _rewardToken) {
        vault = _vault;
        rewardToken = _rewardToken;
        _rewardToken.approve(address(_vault), type(uint256).max);
    }

    function _disburse(address recipient, uint256 balance) private {
        if (balance > 0) {
            emit RewardPaid(recipient, address(rewardToken), balance);
            rewardToken.safeTransfer(recipient, balance);
        }
    }

    function _disburseToInternalBalance(address payable recipient, uint256 balance) private {
        if (balance > 0) {
            IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);

            ops[0] = IVault.UserBalanceOp({
                asset: IAsset(address(rewardToken)),
                amount: balance,
                sender: address(this),
                recipient: recipient,
                kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
            });

            emit RewardPaid(recipient, address(rewardToken), balance);
            vault.manageUserBalance(ops);
        }
    }

    /**
     * @notice Allows a user to claim a particular week's worth of rewards
     */
    function claimWeek(
        address payable liquidityProvider,
        uint256 week,
        uint256 claimedBalance,
        bytes32[] memory merkleProof
    ) external {
        require(msg.sender == liquidityProvider, "user must claim own balance");
        require(!claimed[week][liquidityProvider], "cannot claim twice");
        require(verifyClaim(liquidityProvider, week, claimedBalance, merkleProof), "Incorrect merkle proof");

        claimed[week][liquidityProvider] = true;
        _disburse(liquidityProvider, claimedBalance);
    }

    struct Claim {
        uint256 week;
        uint256 balance;
        bytes32[] merkleProof;
    }

    function _processClaims(address payable liquidityProvider, Claim[] memory claims)
        internal
        returns (uint256 totalBalance)
    {
        Claim memory claim;
        for (uint256 i = 0; i < claims.length; i++) {
            claim = claims[i];

            require(!claimed[claim.week][liquidityProvider], "cannot claim twice");
            require(
                verifyClaim(liquidityProvider, claim.week, claim.balance, claim.merkleProof),
                "Incorrect merkle proof"
            );

            totalBalance = totalBalance.add(claim.balance);
            claimed[claim.week][liquidityProvider] = true;
        }
    }

    /**
     * @notice Allows a user to claim multiple weeks of reward
     */
    function claimWeeks(address payable liquidityProvider, Claim[] memory claims) external {
        require(msg.sender == liquidityProvider, "user must claim own balance");

        uint256 totalBalance = _processClaims(liquidityProvider, claims);
        _disburse(liquidityProvider, totalBalance);
    }

    /**
     * @notice Allows a user to claim multiple weeks of reward to internal balance
     */
    function claimWeeksToInternalBalance(address payable liquidityProvider, Claim[] memory claims) external {
        require(msg.sender == liquidityProvider, "user must claim own balance");

        uint256 totalBalance = _processClaims(liquidityProvider, claims);

        _disburseToInternalBalance(liquidityProvider, totalBalance);
    }

    /**
     * @notice Allows a user to claim several weeks of rewards to a callback
     */
    function claimWeeksWithCallback(
        address payable liquidityProvider,
        address payable callbackContract,
        bytes calldata callbackData,
        Claim[] memory claims
    ) external returns (bytes memory) {
        require(msg.sender == liquidityProvider, "user must claim own balance");
        uint256 totalBalance = _processClaims(liquidityProvider, claims);

        _disburseToInternalBalance(callbackContract, totalBalance);

        return Address.functionCall(callbackContract, callbackData);
    }

    function claimStatus(
        address liquidityProvider,
        uint256 begin,
        uint256 end
    ) external view returns (bool[] memory) {
        require(begin <= end, "weeks must be specified in ascending order");
        uint256 size = 1 + end - begin;
        bool[] memory arr = new bool[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = claimed[begin + i][liquidityProvider];
        }
        return arr;
    }

    function merkleRoots(uint256 begin, uint256 end) external view returns (bytes32[] memory) {
        require(begin <= end, "weeks must be specified in ascending order");
        uint256 size = 1 + end - begin;
        bytes32[] memory arr = new bytes32[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = weekMerkleRoots[begin + i];
        }
        return arr;
    }

    function verifyClaim(
        address liquidityProvider,
        uint256 week,
        uint256 claimedBalance,
        bytes32[] memory merkleProof
    ) public view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(liquidityProvider, claimedBalance));
        return MerkleProof.verify(merkleProof, weekMerkleRoots[week], leaf);
    }

    /**
     * @notice
     * Allows the owner to add funds to the contract as a merkle tree, These tokens will
     * be withdrawn from the sender
     * These will be pulled from the user
     */
    function seedAllocations(
        uint256 week,
        bytes32 _merkleRoot,
        uint256 amount
    ) external onlyOwner {
        require(weekMerkleRoots[week] == bytes32(0), "cannot rewrite merkle root");
        weekMerkleRoots[week] = _merkleRoot;
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardAdded(address(rewardToken), amount);
    }
}
