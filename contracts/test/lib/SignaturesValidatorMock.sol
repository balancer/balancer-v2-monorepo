// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

import "../../lib/helpers/SignaturesValidator.sol";

contract SignaturesValidatorMock is SignaturesValidator {
    event Authenticated(address user, address sender);
    event CalldataDecoded(bytes data, uint256 deadline, uint8 v, bytes32 r, bytes32 s);

    function decodeCalldata() external {
        _decodeCalldata();
    }

    function authenticateCall(address _user) external authenticateBySig(_user) {
        _decodeCalldata();
        emit Authenticated(_user, msg.sender);
    }

    function anotherFunction(address _user) external {
        // do nothing
    }

    function increaseNonce(address _user) external {
        nextNonce[_user]++;
    }

    function _decodeCalldata() internal {
        (uint8 v, bytes32 r, bytes32 s) = _signature();
        emit CalldataDecoded(_calldata(), _deadline(), v, r, s);
    }

    function getChainId() external pure returns (uint256) {
        return _chainId();
    }
}
