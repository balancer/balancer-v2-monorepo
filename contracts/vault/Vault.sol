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

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

// Imports

import "./FlashLoanProvider.sol";
import "./Swaps.sol";
import "./Admin.sol";

// Contracts

// solhint-disable no-empty-blocks

/**
 * @title Vault contract - stores all protocol assets, performs swaps and flash loans
 * @author Balancer Labs
 * @notice The core contract of Balancer v2; contains data structures that store pools in
 *         encoded form. New pools register themselves with the vault, which performs swaps
 *         using logic in the pool contracts.
 */
contract Vault is Admin, Swaps, FlashLoanProvider {
    /**
     * @notice Creates the vault, controlled by an admin account
     * @dev The admin account can set protocol-level parameters, and collect fees
     * @param admin - address of the vault controller account
     */
    constructor(address admin) Admin(admin) {}
}
