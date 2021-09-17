// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

/**
 * @dev These functions deal with verification of Merkle trees (hash trees),
 */
library MerkleProof {
    /**
     * @dev Returns true if a `leaf` can be proved to be a part of a Merkle tree
     * defined by `root`. For this, a `proof` must be provided, containing
     * sibling hashes on the branch from the leaf to the root of the tree. Each
     * pair of leaves and each pair of pre-images are assumed to be sorted.
     */
    function verify(bytes32[] memory proof, bytes32 root, bytes32 leaf) internal pure returns (bool, bytes32 branchLevelHash, uint branchLevelIndex) {
        bytes32 computedHash = leaf;
        uint index;
        uint256 i;

        for (i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];

            if (computedHash <= proofElement) {
                // Hash(current computed hash + current element of the proof)
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
                index += 2**i;
            } else {
                // Hash(current element of the proof + current computed hash)
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
            if (i == 7) {
              branchLevelHash = computedHash;
              branchLevelIndex = index;
            }
        }
        if (i < 8) {
          branchLevelHash = computedHash;
          branchLevelIndex = index;
        }

        // Check if the computed hash (root) is equal to the provided root
        return (computedHash == root, branchLevelHash, branchLevelIndex);
    }
}
