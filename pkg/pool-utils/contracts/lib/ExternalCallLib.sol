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
    function bubbleUpNonMaliciousRevert(bytes memory errorData) internal pure {
        uint256 errorLength = errorData.length;

        // solhint-disable-next-line no-inline-assembly
        assembly {
            // If the first 4 bytes match the selector for one of the error signatures used by `BasePool._queryAction`
            // or `Vault.queryBatchSwap` then this error is attempting to impersonate the query mechanism used by these
            // contracts in order to inject bogus data. This can result in loss of funds if the return value is then
            // used in a later calculation.
            //
            // We then want to reject the following error signatures:
            // - `QueryError(uint256,uint256[])` (used by `BasePool._queryAction`)
            // - `QueryError(int256[])` (used by `Vault.queryBatchSwap`)

            // We only bubble up the revert reason if it doesn't match the any of the selectors for these error
            // sigatures, otherwise we revert with a new error message flagging that the revert was malicious.
            let error := and(
                mload(add(errorData, 0x20)),
                0xffffffff00000000000000000000000000000000000000000000000000000000
            )
            if iszero(
                or(
                    // BasePool._queryAction
                    eq(error, 0x43adbafb00000000000000000000000000000000000000000000000000000000),
                    // Vault.queryBatchSwap
                    eq(error, 0xfa61cc1200000000000000000000000000000000000000000000000000000000)
                )
            ) {
                revert(add(errorData, 0x20), errorLength)
            }
        }

        // We expect the assembly block to revert for all non-malicious errors.
        _revert(Errors.MALICIOUS_QUERY_REVERT);
    }
}
