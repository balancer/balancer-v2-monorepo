// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "../helpers/EOASignaturesValidator.sol";

contract EOASignaturesValidatorMock is EOASignaturesValidator {
    event Authenticated();

    bytes32 public constant MOCK_AUTHENTICATE_TYPEHASH = keccak256("Authenticate(uint256 amount,uint256 nonce)");

    constructor() EIP712("EOA Signatures Validator Mock", "1") {
        // solhint-disable-previous-line no-empty-blocks
    }

    function authenticatedCall(
        address user,
        uint256 amount,
        bytes memory signature
    ) external {
        bytes32 structHash = keccak256(abi.encode(MOCK_AUTHENTICATE_TYPEHASH, amount, getNextNonce(user)));

        _ensureValidSignature(user, structHash, signature, Errors.INVALID_SIGNATURE);
        emit Authenticated();
    }

    function authenticatedCallWithDeadline(
        address user,
        uint256 amount,
        bytes memory signature,
        uint256 deadline
    ) external {
        // Note that the deadline should be included in a real signing scheme - we keep it out here for simplicity.
        bytes32 structHash = keccak256(abi.encode(MOCK_AUTHENTICATE_TYPEHASH, amount, getNextNonce(user)));

        _ensureValidSignature(user, structHash, signature, deadline, Errors.INVALID_SIGNATURE);
        emit Authenticated();
    }

    function increaseNonce(address user) external {
        _nextNonce[user]++;
    }
}
