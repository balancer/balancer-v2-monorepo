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

library ExternalCallLib {
    function checkForMaliciousRevert(bytes memory errorData) internal pure {
        uint256 errorLength = errorData.length;
        assembly {
            // If the first 4 bytes match the error signature "QueryError(uint256,uint256[])" then this
            // error is attempting to impersonate the mechanism used by `BasePool._queryAction`, injecting bogus data.
            // This can result in loss of funds if the return value of `BasePool._queryAction` is then used in a later
            // calculation.

            // We only forward the revert reason if it doesn't match the error sigature "QueryError(uint256,uint256[])",
            // otherwise we return a new error message flagging that the revert was malicious.
            let error := and(
                mload(add(errorData, 0x20)),
                0xffffffff00000000000000000000000000000000000000000000000000000000
            )
            if iszero(eq(error, 0x43adbafb00000000000000000000000000000000000000000000000000000000)) {
                revert(add(errorData, 0x20), errorLength)
            }
        }

        // We expect the assembly block to revert for all non-malicious errors.
        _revert(Errors.MALICIOUS_QUERY_REVERT);
    }
}
