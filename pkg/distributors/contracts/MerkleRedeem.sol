pragma experimental ABIEncoderV2;

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Ownable.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/MerkleProof.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IAsset.sol";

pragma solidity ^0.7.0;

contract MerkleRedeem is Ownable {
    IERC20 public rewardToken;

    event Claimed(address _claimant, uint256 _balance);

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
            emit Claimed(_recipient, _balance);
            require(rewardToken.transfer(_recipient, _balance), "ERR_TRANSFER_FAILED");
        }
    }

    function _sweep(address payable _recipient, uint256 _balance) private {
        if (_balance > 0) {
            IVault.UserBalanceOp[] memory ops = new IVault.UserBalanceOp[](1);

            ops[0] = IVault.UserBalanceOp({
                asset: IAsset(address(rewardToken)),
                amount: _balance,
                sender: address(this),
                recipient: _recipient,
                kind: IVault.UserBalanceOpKind.DEPOSIT_INTERNAL
            });

            vault.manageUserBalance(ops);

            emit Claimed(_recipient, _balance);
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
        require(!claimed[_week][_liquidityProvider], "cannot claim twice");
        require(verifyClaim(_liquidityProvider, _week, _claimedBalance, _merkleProof), "Incorrect merkle proof");

        claimed[_week][_liquidityProvider] = true;
        if (internalBalance) {
            _sweep(_liquidityProvider, _claimedBalance);
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
        uint256 totalBalance = 0;
        Claim memory claim;
        for (uint256 i = 0; i < claims.length; i++) {
            claim = claims[i];

            require(!claimed[claim.week][_liquidityProvider], "cannot claim twice");
            require(
                verifyClaim(_liquidityProvider, claim.week, claim.balance, claim.merkleProof),
                "Incorrect merkle proof"
            );

            totalBalance += claim.balance;
            claimed[claim.week][_liquidityProvider] = true;
        }

        if (useInternalBalance) {
            _sweep(_liquidityProvider, totalBalance);
        } else {
            _disburse(_liquidityProvider, totalBalance);
        }
    }

    function claimStatus(
        address _liquidityProvider,
        uint256 _begin,
        uint256 _end
    ) external view returns (bool[] memory) {
        uint256 size = 1 + _end - _begin;
        bool[] memory arr = new bool[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = claimed[_begin + i][_liquidityProvider];
        }
        return arr;
    }

    function merkleRoots(uint256 _begin, uint256 _end) external view returns (bytes32[] memory) {
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

    function seedAllocations(uint256 _week, bytes32 _merkleRoot) external onlyOwner {
        require(weekMerkleRoots[_week] == bytes32(0), "cannot rewrite merkle root");
        weekMerkleRoots[_week] = _merkleRoot;
    }
}
