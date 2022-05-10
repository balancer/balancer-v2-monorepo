// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "../helpers/SignaturesValidator.sol";

contract SignaturesValidatorMock is SignaturesValidator {
    bytes32 internal immutable AUTH_TYPE_HASH = keccak256(
        "Authorization(bytes calldata,address sender,uint256 nonce,uint256 deadline)"
    );

    event Authenticated(address user, address sender);
    event CalldataDecoded(bytes data, uint256 deadline, uint8 v, bytes32 r, bytes32 s);

    constructor() SignaturesValidator("Balancer V2 Vault") {
        // solhint-disable-previous-line no-empty-blocks
    }

    function decodeCalldata() external {
        _decodeCalldata();
    }

    function authenticateCall(address user) external {
        _validateSignature(user, Errors.INVALID_SIGNATURE);
        _decodeCalldata();
        emit Authenticated(user, msg.sender);
    }

    function anotherFunction(address user) external {
        // do nothing
    }

    function increaseNonce(address user) external {
        _nextNonce[user]++;
    }

    function _decodeCalldata() internal {
        (uint8 v, bytes32 r, bytes32 s) = _signature();
        emit CalldataDecoded(_calldata(), _deadline(), v, r, s);
    }

    function _typeHash() internal view override returns (bytes32) {
        return AUTH_TYPE_HASH;
    }
}
