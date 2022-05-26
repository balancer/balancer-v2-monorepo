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

import "@balancer-labs/v2-solidity-utils/contracts/helpers/SingletonAuthentication.sol";

/*
 * @author Balancer Labs
 * @title MockAuthenticatedContract
 * @notice Generic authenticated contract
 * @dev A general purpose contract that can be used for testing permissioned functions in a more abstract way,
 * to test Authorizer functionality independent of specific Vault functions.
 */
contract MockAuthenticatedContract is SingletonAuthentication {
    event ProtectedFunctionCalled(bytes data);
    event SecondProtectedFunctionCalled(bytes data);

    constructor(IVault vault) SingletonAuthentication(vault) {}

    function protectedFunction(bytes calldata data) external authenticate returns (bytes memory) {
        emit ProtectedFunctionCalled(data);
        return data;
    }

    function secondProtectedFunction(bytes calldata data) external authenticate returns (bytes memory) {
        emit SecondProtectedFunctionCalled(data);
        return data;
    }
}
