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

pragma solidity ^0.7.0;

contract MerkleRedeem is IDistributor, Ownable {
    using FixedPoint for uint256;
    using SafeERC20 for IERC20;

    IERC20 public rewardToken;

    // Recorded weeks
    mapping(uint256 => bytes32) public weekMerkleRoots;
    mapping(uint256 => mapping(address => bool)) public claimed;

    IVault public vault;

    constructor(address _vault, address _rewardToken) {
        vault = IVault(_vault);
        rewardToken = IERC20(_rewardToken);
        rewardToken.approve(address(vault), type(uint256).max);
    }

    function _disburse(address _recipient, uint256 _balance) private {
        if (_balance > 0) {
            emit RewardPaid(_recipient, address(rewardToken), _balance);
            rewardToken.safeTransfer(_recipient, _balance);
        }
    }

    function _disburseToInternalBalance(address payable _recipient, uint256 _balance) private {
        if (_balance > 0) {
            IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);

            ops[0] = IVault.UserBalanceOp({
                asset: IAsset(address(rewardToken)),
                amount: _balance,
                sender: address(this),
                recipient: _recipient,
                kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
            });

            emit RewardPaid(_recipient, address(rewardToken), _balance);
            vault.manageUserBalance(ops);
        }
    }

    /**
     * @notice Allows a user to claim a particular weeks worth of rewards
     */
    function claimWeek(
        address payable _liquidityProvider,
        uint256 _week,
        uint256 _claimedBalance,
        bytes32[] memory _merkleProof,
        bool internalBalance
    ) public {
        require(msg.sender == _liquidityProvider, "user must claim own balance");
        require(!claimed[_week][_liquidityProvider], "cannot claim twice");
        require(verifyClaim(_liquidityProvider, _week, _claimedBalance, _merkleProof), "Incorrect merkle proof");

        claimed[_week][_liquidityProvider] = true;
        if (internalBalance) {
            _disburseToInternalBalance(_liquidityProvider, _claimedBalance);
        } else {
            _disburse(_liquidityProvider, _claimedBalance);
        }
    }

    struct Claim {
        uint256 week;
        uint256 balance;
        bytes32[] merkleProof;
    }

    /**
     * @notice Allows a user to claim a particular weeks worth of rewards
     */
    function claimWeeks(
        address payable _liquidityProvider,
        Claim[] memory claims,
        bool useInternalBalance
    ) public {
        require(msg.sender == _liquidityProvider, "user must claim own balance");
        uint256 totalBalance = 0;
        Claim memory claim;
        for (uint256 i = 0; i < claims.length; i++) {
            claim = claims[i];

            require(!claimed[claim.week][_liquidityProvider], "cannot claim twice");
            require(
                verifyClaim(_liquidityProvider, claim.week, claim.balance, claim.merkleProof),
                "Incorrect merkle proof"
            );

            totalBalance = totalBalance.add(claim.balance);
            claimed[claim.week][_liquidityProvider] = true;
        }

        if (useInternalBalance) {
            _disburseToInternalBalance(_liquidityProvider, totalBalance);
        } else {
            _disburse(_liquidityProvider, totalBalance);
        }
    }

    function claimStatus(
        address _liquidityProvider,
        uint256 _begin,
        uint256 _end
    ) external view returns (bool[] memory) {
        require(_begin <= _end, "weeks must be specified in ascending order");
        uint256 size = 1 + _end - _begin;
        bool[] memory arr = new bool[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = claimed[_begin + i][_liquidityProvider];
        }
        return arr;
    }

    function merkleRoots(uint256 _begin, uint256 _end) external view returns (bytes32[] memory) {
        require(_begin <= _end, "weeks must be specified in ascending order");
        uint256 size = 1 + _end - _begin;
        bytes32[] memory arr = new bytes32[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = weekMerkleRoots[_begin + i];
        }
        return arr;
    }

    function verifyClaim(
        address _liquidityProvider,
        uint256 _week,
        uint256 _claimedBalance,
        bytes32[] memory _merkleProof
    ) public view returns (bool valid) {
        bytes32 leaf = keccak256(abi.encodePacked(_liquidityProvider, _claimedBalance));
        return MerkleProof.verify(_merkleProof, weekMerkleRoots[_week], leaf);
    }

    /**
     * @notice
     * Allows the owner to add funds to the contract as a merkle tree, These tokens will
     * be withdrawn from the sender
     * These will be pulled from the user
     */
    function seedAllocations(
        uint256 _week,
        bytes32 _merkleRoot,
        uint256 amount
    ) external onlyOwner {
        require(weekMerkleRoots[_week] == bytes32(0), "cannot rewrite merkle root");
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        weekMerkleRoots[_week] = _merkleRoot;
        emit RewardAdded(address(rewardToken), amount);
    }
}
