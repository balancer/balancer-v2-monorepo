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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/helpers/BalancerErrors.sol";

/**
 * @dev Library used to deploy contracts with specific code. This can be used for long-term storage of immutable data as
 * contract code, which can be retrieved via the `extcodecopy` opcode.
 */
library CodeDeployer {
    // During contract construction, the full code supplied exists as code, and can be accessed via `codesize` and
    // `codecopy`. This is not the contract's final code however: whatever the constructor returns is what will be
    // stored as its code.
    //
    // We use this mechanism to have a simple constructor that stores whatever is appended to it. The following opcode
    // sequence corresponds to the creation code of the following equivalent Solidity contract, plus padding to make the
    // full code 32 bytes long:
    //
    // contract CodeDeployer {
    //     constructor() payable {
    //         uint256 size;
    //         assembly {
    //             size := sub(codesize(), 32) // size of appended data, as constructor is 32 bytes long
    //             codecopy(0, 32, size) // copy all appended data to memory at position 0
    //             return(0, size) // return appended data for it to be stored as code
    //         }
    //     }
    // }
    //
    // More specifically, it is composed of the following opcodes (plus padding):
    //
    // [1] PUSH1 0x20
    // [2] CODESIZE
    // [3] SUB
    // [4] DUP1
    // [6] PUSH1 0x20
    // [8] PUSH1 0x00
    // [9] CODECOPY
    // [11] PUSH1 0x00
    // [12] RETURN
    //
    // The padding is just the 0xfe sequence (invalid opcode). It is important as it lets us work in-place, avoiding
    // memory allocation and copying.

    bytes32
        private constant _DEPLOYER_CREATION_CODE = 0x602038038060206000396000f3fefefefefefefefefefefefefefefefefefefe;

    // Sometimes (e.g., when deploying the second or "B" half of the creation code in BaseSplitCodeFactory), we need to
    // protect the bare contract from being accidentally (or maliciously) executed, in case the bytes at the boundary
    // happen to be valid opcodes. It's especially dangerous if the bytes contained the selfdestruct opcode, which would
    // destroy the contract (and, if it's a factory, effectively disable it and prevent further pool creation).
    //
    // To guard against this, if the "preventExecution" flag is set, we prepend an invalid opcode to the contract,
    // to ensure that it cannot be executed, regardless of its content.
    //
    // This corresponds to the following contract:
    //
    // contract CodeDeployer {
    //     constructor() payable {
    //         uint256 size;
    //         assembly {
    //             mstore8(0, 0xfe) // store invalid opcode at position 0
    //             size := sub(codesize(), 32) // size of appended data, as constructor is 32 bytes long
    //             codecopy(1, 32, size) // copy all appended data to memory at position 1
    //             return(0, add(size, 1)) // return appended data (plus the extra byte) for it to be stored as code
    //         }
    //     }
    // }
    //
    // More specifically, it is composed of the following opcodes (plus padding, described above):
    //
    // [1] PUSH1 0xfe
    // [3] PUSH1 0x00
    // [4] MSTORE8
    // [6] PUSH1 0x20
    // [7] CODESIZE
    // [8] SUB
    // [9] DUP1
    // [11] PUSH1 0x20
    // [13] PUSH1 0x01
    // [14] CODECOPY
    // [16] PUSH1 0x01
    // [17] ADD
    // [19] PUSH1 0x00
    // [20] RETURN

    // solhint-disable max-line-length
    bytes32
        private constant _PROTECTED_DEPLOYER_CREATION_CODE = 0x60fe600053602038038060206001396001016000f3fefefefefefefefefefefe;

    /**
     * @dev Deploys a contract with `code` as its code, returning the destination address.
     * If preventExecution is set, prepend an invalid opcode to ensure the "contract" cannot be executed.
     * Rather than add a flag, we could simply always prepend the opcode, but there might be use cases where fidelity
     * is required.
     *
     * Reverts if deployment fails.
     */
    function deploy(bytes memory code, bool preventExecution) internal returns (address destination) {
        bytes32 deployerCreationCode = preventExecution ? _PROTECTED_DEPLOYER_CREATION_CODE : _DEPLOYER_CREATION_CODE;

        // We need to concatenate the deployer creation code and `code` in memory, but want to avoid copying all of
        // `code` (which could be quite long) into a new memory location. Therefore, we operate in-place using
        // assembly.

        // solhint-disable-next-line no-inline-assembly
        assembly {
            let codeLength := mload(code)

            // `code` is composed of length and data. We've already stored its length in `codeLength`, so we simply
            // replace it with the deployer creation code (which is exactly 32 bytes long).
            mstore(code, deployerCreationCode)

            // At this point, `code` now points to the deployer creation code immediately followed by `code`'s data
            // contents. This is exactly what the deployer expects to receive when created.
            destination := create(0, code, add(codeLength, 32))

            // Finally, we restore the original length in order to not mutate `code`.
            mstore(code, codeLength)
        }

        // The create opcode returns the zero address when contract creation fails, so we revert if this happens.
        _require(destination != address(0), Errors.CODE_DEPLOYMENT_FAILED);
    }
}
