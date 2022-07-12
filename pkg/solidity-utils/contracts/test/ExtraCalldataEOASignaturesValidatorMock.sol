// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "../helpers/ExtraCalldataEOASignaturesValidator.sol";

contract ExtraCalldataEOASignaturesValidatorMock is ExtraCalldataEOASignaturesValidator {
    bytes32 internal constant AUTH_TYPE_HASH = keccak256(
        "Authorization(bytes calldata,address sender,uint256 nonce,uint256 deadline)"
    );

    event Authenticated(address user, address sender);
    event CalldataDecoded(bytes data, uint256 deadline, bytes signature);

    constructor() EIP712("Balancer V2 Vault", "1") {
        // solhint-disable-previous-line no-empty-blocks
    }

    function decodeCalldata() external {
        _decodeCalldata();
    }

    function authenticateCall(address user) external {
        _validateExtraCalldataSignature(user, Errors.INVALID_SIGNATURE);
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
        emit CalldataDecoded(_calldata(), _deadline(), _signature());
    }

    function _entrypointTypeHash() internal pure override returns (bytes32) {
        return AUTH_TYPE_HASH;
    }
}
