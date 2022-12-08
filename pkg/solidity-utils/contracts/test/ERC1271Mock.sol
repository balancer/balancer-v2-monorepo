// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC1271.sol";

contract ERC1271Mock is IERC1271 {
    mapping(bytes32 => bool) private _approved;
    bool private _revert;

    function setApproved(bytes32 key) external {
        _approved[key] = true;
    }

    function setRevert(bool newRevert) external {
        _revert = newRevert;
    }

    function getKey(bytes32 digest, bytes memory signature) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(digest, signature));
    }

    function isValidSignature(bytes32 digest, bytes memory signature) external view override returns (bytes4) {
        require(!_revert, "ERC1271_MOCK_REVERT");

        return _approved[getKey(digest, signature)] ? IERC1271.isValidSignature.selector : bytes4(0);
    }
}
