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

/**
 * @dev Contract that has the code of the argument it receives in its constructor. Useful to store data as code.
 */
contract CodeDeployer {
    constructor(bytes memory code) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // The contract's code will be whatever the constructor returns. Since code is a memory array, it points to
            // its length, and the data contents begin 32 bytes later.
            return(add(code, 32), mload(code))
        }
    }
}
