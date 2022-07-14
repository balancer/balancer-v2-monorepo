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

import "../helpers/OptionalOnlyCaller.sol";

/**
 * @dev Mock with an external method that affects an address.
 *
 * The user can opt in to a verification, so that the method becomes callable
 * only by their address.
 */
contract OptionalOnlyCallerMock is OptionalOnlyCaller {
    constructor() EIP712("OptionalOnlyCallerMock", "1") {}

    event TestFunctionCalled();

    function testFunction(address user) external optionalOnlyCaller(user) {
        emit TestFunctionCalled();
    }
}
