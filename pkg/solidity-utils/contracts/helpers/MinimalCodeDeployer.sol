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

/**
 * @dev Library used to deploy contracts with specific code.
 */
library MinimalCodeDeployer {
    // The following sequence corresponds to the creation code of the following equivalent Solidity contract, plus
    // padding to make the full code 32 bytes long:
    //
    // contract MinimalCodeDeployer {
    //     constructor() payable {
    //         uint256 size;
    //         assembly {
    //             size := sub(codesize(), 32)
    //             codecopy(0, 32, size)
    //             return(0, size)
    //         }
    //     }
    // }
    //
    // More concretely, it is composed of the following opcodes (plus padding):
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
    // This simple contract takes whatever data was appended to it during creation, and stores that as its code.

    bytes32 public constant creationCode = 0x602038038060206000396000f3fefefefefefefefefefefefefefefefefefefe;

    /**
     * @dev Deploys a contract with `code` as its code, returning the destination address.
     *
     * Reverts if deployment fails.
     *
     * WARNING: `code` is mutated by this call.
     */
    function deploy(bytes memory code) internal returns (address destination) {
        uint256 codeLength = code.length;
        bytes32 deployerCreationCode = MinimalCodeDeployer.creationCode;

        // solhint-disable-next-line no-inline-assembly
        assembly {
            // `code` is composed of length and data. We've already stored the length in `codeLength`, so we can simply
            // replace it with the deployer creation code (which is exactly 32 bytes long).
            mstore(code, deployerCreationCode)
            // At this point, `code` now points to the deployer creation code immediately followed by `code` data
            // contents. This is exactly what the deployer expects to receive when created.
            destination := create(0, code, add(codeLength, 32))
        }

        _require(destination != address(0), Errors.DEPLOYMENT_FAILED);
    }
}
