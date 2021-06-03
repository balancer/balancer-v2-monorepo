// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface IERC20PermitDAI {
    /**
     * @notice update allowance with a signed permit
     * @param holder    Token owner's address (Authorizer)
     * @param spender   Spender's address
     * @param nonce     The permit nonce
     * @param expiry    The time at which this expires (unix time)
     * @param allowed   Whether the spender is allowed or disallowed from spending
     * @param v         v of the signature
     * @param r         r of the signature
     * @param s         s of the signature
     */
    function permit(
        address holder,
        address spender,
        uint256 nonce,
        uint256 expiry,
        bool allowed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
