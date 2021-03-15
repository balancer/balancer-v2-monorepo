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
pragma experimental ABIEncoderV2;

import "../authorizer/IAuthorizer.sol";
import "../lib/helpers/EmergencyPeriod.sol";

import "./VaultAuthorization.sol";
import "./FlashLoanProvider.sol";
import "./Swaps.sol";

/**
 * @dev The `Vault` is Balancer V2's core contract. A single instance of it exists in the entire network, and it is the
 * entity used to interact with Pools by joining, exiting, or swapping with them.
 *
 * The `Vault`'s source code is split among a number of sub-contracts with the goal of improving readability and making
 * understanding the system easier. All sub-contracts have been marked as `abstract` to make explicit the fact that only
 * the full `Vault` is meant to be deployed.
 *
 * Roughly speaking, these are the contents of each sub-contract:
 *
 *  - `InternalBalance`: deposit, withdrawal and transfer of Internal Balance.
 *  - `Fees`: set and compute protocol fees.
 *  - `FlashLoanProvider`: flash loans.
 *  - `PoolRegistry`: Pool registration, joining, exiting, and Asset Manager interactions.
 *  - `Swaps`: Pool swaps.
 *
 * Additionally, the different Pool specializations are handled by the `GeneralPoolsBalance`,
 * `MinimalSwapInfoPoolsBalance` and `TwoTokenPoolsBalance` sub-contracts, which in turn make use of the
 * `BalanceAllocation` library.
 *
 * The most important goal of the `Vault` is to make token swaps use as little gas as possible. This is reflected in a
 * multitude of design decisions, from minor things like the format used to store Pool IDs, to major features such as
 * the different Pool specialization settings.
 *
 * Finally, the large number of tasks carried out by the Vault mean its bytecode is very large, which is at odds with
 * the contract size limit imposed by EIP 170 (https://eips.ethereum.org/EIPS/eip-170). Manual tuning of the source code
 * was required to improve code generation and bring the bytecode size below this limit. This includes extensive
 * utilization of `internal` functions (particularly inside modifiers), usage of named return arguments, and dedicated
 * storage access methods, to name a few.
 */
contract Vault is VaultAuthorization, FlashLoanProvider, Swaps {
    constructor(
        IAuthorizer authorizer,
        uint256 emergencyPeriod,
        uint256 emergencyPeriodCheckExtension
    ) VaultAuthorization(authorizer) EmergencyPeriod(emergencyPeriod, emergencyPeriodCheckExtension) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function setEmergencyPeriod(bool active) external authenticate {
        _setEmergencyPeriod(active);
    }
}
