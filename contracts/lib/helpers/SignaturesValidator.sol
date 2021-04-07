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

import "../../vault/interfaces/ISignaturesValidator.sol";

/* solhint-disable max-line-length */
/* solhint-disable prettier/prettier */
/* solhint-disable var-name-mixedcase */
/* solhint-disable private-vars-leading-underscore */

abstract contract SignaturesValidator is ISignaturesValidator {
    uint256 internal constant EXTRA_CALLDATA_LENGTH = 32 * 4; // deadline + [v,r,s] signature
    bytes32 internal constant SIGNATURE_S_UPPER_RANGE = bytes32(0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0);

    bytes32 internal immutable NAME_HASH = keccak256("Balancer Protocol");
    bytes32 internal immutable VERSION_HASH = keccak256("1");
    bytes32 internal immutable EIP712_DOMAIN_HASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    mapping(address => uint256) internal _nextNonce;

    /**
     * @dev Get next nonce for an address
     */
    function getNextNonce(address user) external view override returns (uint256) {
        return _nextNonce[user];
    }

    /**
     * @dev Get EIP712 domain separator
     */
    function getDomainSeparator() external view override returns (bytes32) {
        return _getDomainSeparator();
    }

    /**
     * @dev Validate signature and increment nonce
     */
    function _validateSignature(address user, uint256 errorCode) internal {
        uint256 nextNonce = _nextNonce[user]++;
        _require(_isSignatureValid(user, nextNonce), errorCode);
    }

    /**
     * @dev Tell whether a signature is valid
     */
    function _isSignatureValid(address user, uint256 nonce) internal view returns (bool) {
        uint256 deadline = _deadline();
        // The deadline is timestamp-based: it should not be relied upon for sub-minute accuracy.
        // solhint-disable-next-line not-rely-on-time
        if (deadline < block.timestamp) {
            return false;
        }

        // All type hashes correspond to the form (bytes calldata, address sender, uint256 nonce, uint256 deadline)
        bytes32 encodeData = keccak256(abi.encode(_typeHash(), keccak256(_calldata()), msg.sender, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _getDomainSeparator(), encodeData));
        (uint8 v, bytes32 r, bytes32 s) = _signature();

        // EIP-2 still allows signature malleability for ecrecover(). Remove this possibility and make the signature
        // unique. Appendix F in the Ethereum Yellow paper (https://ethereum.github.io/yellowpaper/paper.pdf), defines
        // the valid range for s in (281): 0 < s < secp256k1n ÷ 2 + 1, and for v in (282): v ∈ {27, 28}. Most
        // signatures from current libraries generate a unique signature with an s-value in the lower half order.
        //
        // If your library generates malleable signatures, such as s-values in the upper range, calculate a new s-value
        // with 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - s1 and flip v from 27 to 28 or
        // vice versa. If your library also generates signatures with 0/1 for v instead 27/28, add 27 to v to accept
        // these malleable signatures as well.
        if ((v != 27 && v != 28) || s > SIGNATURE_S_UPPER_RANGE) {
            return false;
        }

        // Explicitly disallow authorizations for address(0) as ecrecover returns address(0) on malformed messages
        address recoveredAddress = ecrecover(digest, v, r, s);
        return recoveredAddress != address(0) && recoveredAddress == user;
    }

    /**
     * @dev Get EIP712 domain separator
     */
    function _getDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_HASH, NAME_HASH, VERSION_HASH, _chainId(), address(this)));
    }

    /**
     * @dev Tell which type hash should be used based on the call selector
     */
    function _typeHash() internal view virtual returns (bytes32);

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
        return uint256(_decodeExtraCalldataWord(0));
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
        // The signature is appended at the end of calldata, after the deadline, in the order v, r, s
        v = uint8(uint256(_decodeExtraCalldataWord(0x20)));
        r = _decodeExtraCalldataWord(0x40);
        s = _decodeExtraCalldataWord(0x60);
    }

    /**
     * @dev Decode original calldata
     */
    function _calldata() internal pure returns (bytes memory result) {
        result = msg.data;
        if (result.length > EXTRA_CALLDATA_LENGTH) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                // Overwrite the array length with the reduced one
                mstore(result, sub(calldatasize(), EXTRA_CALLDATA_LENGTH))
            }
        }
    }

    /**
     * @dev Decode word from extra calldata
     */
    function _decodeExtraCalldataWord(uint256 offset) internal pure returns (bytes32 result) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // Retrieve the next free memory slot (the free memory pointer)
            let ptr := mload(0x40)
            // Advance the free memory pointer by 32 bytes
            mstore(0x40, add(ptr, 0x20))
            // Store the calldata word in the allocated space
            calldatacopy(ptr, add(sub(calldatasize(), EXTRA_CALLDATA_LENGTH), offset), 0x20)
            result := mload(ptr)
        }
    }
}
