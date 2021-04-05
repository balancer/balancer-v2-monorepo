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

pragma solidity ^0.7.0;

import "./BalancerErrors.sol";

interface IERC712 {
    /**
     * @dev Get EIP712 domain separator
     */
    function getDomainSeparator() external view returns (bytes32);
}

/* solhint-disable max-line-length */
/* solhint-disable private-vars-leading-underscore */

contract SignaturesValidator is IERC712 {
    // [v,r,s] signature + deadline
    uint256 internal constant EXTRA_CALLDATA_LENGTH = 32 * 4;
    // bytes32 private constant AUTH_TYPE_HASH = keccak256("Authorization(bytes calldata,address sender,uint256 nonce,uint256 deadline)")
    bytes32 internal constant AUTH_TYPE_HASH = 0x088e910861b9d0ac056c32bb5d44fcdd155bbfa025bdca87c7390e174ac61795;
    // bytes32 private constant EIP712_DOMAIN_HASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    bytes32 internal constant EIP712_DOMAIN_HASH = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
    // bytes32 private constant NAME_HASH = keccak256("Balancer Protocol")
    bytes32 internal constant NAME_HASH = 0x551a330e0cd7068f91f1cc53010b957ee0feca1b22c7205ecd33fee714ec06bf;
    // bytes32 private constant VERSION_HASH = keccak256("1")
    bytes32 internal constant VERSION_HASH = 0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6;

    modifier authenticateBySig(address user) {
        _validateSignature(user);
        _;
    }

    mapping(address => uint256) internal nextNonce;

    /**
     * @dev Get next nonce for an address
     */
    function getNextNonce(address user) external view returns (uint256) {
        return nextNonce[user];
    }

    /**
     * @dev Get EIP712 domain separator
     */
    function getDomainSeparator() external view override returns (bytes32) {
        return _getDomainSeparator();
    }

    /**
     * @dev Validate signature
     */
    function _validateSignature(address user) internal {
        _require(_isSignatureValid(user), Errors.INVALID_SIGNATURE);
    }

    /**
     * @dev Tell whether a signature is valid and update nonce
     */
    function _isSignatureValid(address user) internal returns (bool) {
        return _isSignatureValid(user, nextNonce[user]++);
    }

    /**
     * @dev Tell whether a signature is valid
     */
    function _isSignatureValid(address user, uint256 nonce) internal view returns (bool) {
        uint256 deadline = _deadline();
        if (deadline < block.timestamp) {
            // solhint-disable-previous-line not-rely-on-time
            return false;
        }

        bytes32 encodeData = keccak256(abi.encode(AUTH_TYPE_HASH, keccak256(_calldata()), msg.sender, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _getDomainSeparator(), encodeData));

        (uint8 v, bytes32 r, bytes32 s) = _signature();
        address recoveredAddress = ecrecover(digest, v, r, s);

        // Explicitly disallow authorizations for address(0) as ecrecover returns address(0) on malformed messages
        return recoveredAddress != address(0) && recoveredAddress == user;
    }

    /**
     * @dev Get EIP712 domain separator
     */
    function _getDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_HASH, NAME_HASH, VERSION_HASH, _chainId(), address(this)));
    }

    /**
     * @dev Chain ID
     */
    function _chainId() internal pure returns (uint256 chainId) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            chainId := chainid()
        }
    }

    /**
     * @dev Auth deadline encoded in calldata
     */
    function _deadline() internal pure returns (uint256) {
        return _decodeExtraCalldataWord(0);
    }

    /**
     * @dev Signature encoded in calldata
     */
    function _signature()
        internal
        pure
        returns (
            uint8 v,
            bytes32 r,
            bytes32 s
        )
    {
        v = uint8(_decodeExtraCalldataWord(0x20));
        r = bytes32(_decodeExtraCalldataWord(0x40));
        s = bytes32(_decodeExtraCalldataWord(0x60));
    }

    /**
     * @dev Decode original calldata
     */
    function _calldata() internal pure returns (bytes memory result) {
        result = msg.data;
        if (result.length > EXTRA_CALLDATA_LENGTH) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                mstore(result, sub(calldatasize(), EXTRA_CALLDATA_LENGTH))
            }
        }
    }

    /**
     * @dev Decode word from extra calldata
     */
    function _decodeExtraCalldataWord(uint256 _offset) internal pure returns (uint256 result) {
        uint256 offset = _offset;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let ptr := mload(0x40)
            mstore(0x40, add(ptr, 0x20))
            calldatacopy(ptr, sub(calldatasize(), sub(EXTRA_CALLDATA_LENGTH, offset)), 0x20)
            result := mload(ptr)
        }
    }
}
