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
import "./ISignaturesValidator.sol";
import "../openzeppelin/EIP712.sol";

/**
 * @dev Utility for signing Solidity function calls.
 *
 * This contract relies on the fact that Solidity contracts can be called with extra calldata, and enables
 * meta-transaction schemes by appending an EIP712 signature of the original calldata at the end.
 *
 * Derived contracts must implement the `_typeHash` function to map function selectors to EIP712 structs.
 */
abstract contract SignaturesValidator is ISignaturesValidator, EIP712 {
    // The appended data consists of a deadline, plus the [v,r,s] signature. For simplicity, we use a full 256 bit slot
    // for each of these values, even if 'v' is typically an 8 bit value.
    uint256 internal constant _EXTRA_CALLDATA_LENGTH = 4 * 32;

    // Replay attack prevention for each user.
    mapping(address => uint256) internal _nextNonce;

    constructor(string memory name) EIP712(name, "1") {
        // solhint-disable-previous-line no-empty-blocks
    }

    function getDomainSeparator() external view override returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getNextNonce(address user) external view override returns (uint256) {
        return _nextNonce[user];
    }

    /**
     * @dev Reverts with `errorCode` unless a valid signature for `user` was appended to the calldata.
     */
    function _validateSignature(address user, uint256 errorCode) internal {
        uint256 nextNonce = _nextNonce[user]++;
        _require(_isSignatureValid(user, nextNonce), errorCode);
    }

    function _isSignatureValid(address user, uint256 nonce) private view returns (bool) {
        uint256 deadline = _deadline();

        // The deadline is timestamp-based: it should not be relied upon for sub-minute accuracy.
        // solhint-disable-next-line not-rely-on-time
        if (deadline < block.timestamp) {
            return false;
        }

        bytes32 typeHash = _typeHash();
        if (typeHash == bytes32(0)) {
            // Prevent accidental signature validation for functions that don't have an associated type hash.
            return false;
        }

        // All type hashes have this format: (bytes calldata, address sender, uint256 nonce, uint256 deadline).
        bytes32 structHash = keccak256(abi.encode(typeHash, keccak256(_calldata()), msg.sender, nonce, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = _signature();

        address recoveredAddress = ecrecover(digest, v, r, s);

        // ecrecover returns the zero address on recover failure, so we need to handle that explicitly.
        return recoveredAddress != address(0) && recoveredAddress == user;
    }

    /**
     * @dev Returns the EIP712 type hash for the current entry point function, which can be identified by its function
     * selector (available as `msg.sig`).
     *
     * The type hash must conform to the following format:
     *  <name>(bytes calldata, address sender, uint256 nonce, uint256 deadline)
     *
     * If 0x00, all signatures will be considered invalid.
     */
    function _typeHash() internal view virtual returns (bytes32);

    /**
     * @dev Extracts the signature deadline from extra calldata.
     *
     * This function returns bogus data if no signature is included.
     */
    function _deadline() internal pure returns (uint256) {
        // The deadline is the first extra argument at the end of the original calldata.
        return uint256(_decodeExtraCalldataWord(0));
    }

    /**
     * @dev Extracts the signature parameters from extra calldata.
     *
     * This function returns bogus data if no signature is included. This is not a security risk, as that data would not
     * be considered a valid signature in the first place.
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
        // v, r and s are appended after the signature deadline, in that order.
        v = uint8(uint256(_decodeExtraCalldataWord(0x20)));
        r = _decodeExtraCalldataWord(0x40);
        s = _decodeExtraCalldataWord(0x60);
    }

    /**
     * @dev Returns the original calldata, without the extra bytes containing the signature.
     *
     * This function returns bogus data if no signature is included.
     */
    function _calldata() internal pure returns (bytes memory result) {
        result = msg.data; // A calldata to memory assignment results in memory allocation and copy of contents.
        if (result.length > _EXTRA_CALLDATA_LENGTH) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                // We simply overwrite the array length with the reduced one.
                mstore(result, sub(calldatasize(), _EXTRA_CALLDATA_LENGTH))
            }
        }
    }

    /**
     * @dev Returns a 256 bit word from 'extra' calldata, at some offset from the expected end of the original calldata.
     *
     * This function returns bogus data if no signature is included.
     */
    function _decodeExtraCalldataWord(uint256 offset) private pure returns (bytes32 result) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            result := calldataload(add(sub(calldatasize(), _EXTRA_CALLDATA_LENGTH), offset))
        }
    }
}
