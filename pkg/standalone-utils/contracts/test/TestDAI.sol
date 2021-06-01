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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20PermitDAI.sol";
import "./TestToken.sol";

/**
 * @notice An implementation of an ERC20 token with DAI's nonstandard permit interface
 */
contract TestDAI is TestToken, IERC20PermitDAI {
    constructor(
        address admin,
        string memory name,
        string memory symbol,
        uint8 decimals
    ) TestToken(admin, name, symbol, decimals) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function permit(
        address holder,
        address spender,
        uint256 nonce,
        uint256 expiry,
        bool allowed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        require(this.nonces(holder) == nonce, "wrong nonce");
        permit(holder, spender, allowed ? type(uint256).max : 0, expiry, v, r, s);
    }
}
