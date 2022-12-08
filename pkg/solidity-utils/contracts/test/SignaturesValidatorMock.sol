// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "../helpers/SignaturesValidator.sol";

contract SignaturesValidatorMock is SignaturesValidator {
    event Authenticated();

    bytes32 public constant MOCK_AUTHENTICATE_TYPEHASH = keccak256("Authenticate(uint256 amount,uint256 nonce)");

    constructor() EIP712("EOA Signatures Validator Mock", "1") {
        // solhint-disable-previous-line no-empty-blocks
    }

    function getStructHash(uint256 amount, uint256 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode(MOCK_AUTHENTICATE_TYPEHASH, amount, nonce));
    }

    function getDigest(uint256 amount, uint256 nonce) public view returns (bytes32) {
        return _hashTypedDataV4(getStructHash(amount, nonce));
    }

    function authenticatedCall(
        address user,
        uint256 amount,
        bytes memory signature
    ) external {
        _ensureValidSignature(user, getStructHash(amount, getNextNonce(user)), signature, Errors.INVALID_SIGNATURE);
        emit Authenticated();
    }

    function authenticatedCallWithDeadline(
        address user,
        uint256 amount,
        bytes memory signature,
        uint256 deadline
    ) external {
        // Note that the deadline should be included in a real signing scheme - we keep it out here for simplicity.
        _ensureValidSignature(
            user,
            getStructHash(amount, getNextNonce(user)),
            signature,
            deadline,
            Errors.INVALID_SIGNATURE
        );
        emit Authenticated();
    }

    function increaseNonce(address user) external {
        _nextNonce[user]++;
    }
}
