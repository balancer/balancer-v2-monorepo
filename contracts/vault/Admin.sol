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

import "./interfaces/IVault.sol";

abstract contract Admin is IVault {
    address internal _admin;

    constructor(address admin_) {
        _admin = admin_;
    }

    function admin() public view returns (address) {
        return _admin;
    }

    function transferAdmin(address newAdmin) external {
        require(msg.sender == _admin, "Caller is not the admin");

        _admin = newAdmin;
    }
}
