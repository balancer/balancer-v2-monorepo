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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

import "../vault/interfaces/IAuthorizer.sol";

// solhint-disable var-name-mixedcase
// solhint-disable func-name-mixedcase

contract Authorizer is IAuthorizer, AccessControl {
    bytes32 public immutable CHANGE_AUTHORIZER_ROLE = keccak256("CHANGE_AUTHORIZER_ROLE");

    bytes32 public immutable SET_PROTOCOL_WITHDRAW_FEE_ROLE = keccak256("SET_PROTOCOL_WITHDRAW_FEE_ROLE");
    bytes32 public immutable SET_PROTOCOL_SWAP_FEE_ROLE = keccak256("SET_PROTOCOL_SWAP_FEE_ROLE");
    bytes32 public immutable SET_PROTOCOL_FLASH_LOAN_FEE_ROLE = keccak256("SET_PROTOCOL_FLASH_LOAN_FEE_ROLE");

    bytes32 public immutable WITHDRAW_PROTOCOL_FEES_ALL_TOKENS_ROLE = keccak256(
        "WITHDRAW_PROTOCOL_FEES_ALL_TOKENS_ROLE"
    );

    function WITHDRAW_PROTOCOL_FEES_SINGLE_TOKEN_ROLE(IERC20 token) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("WITHDRAW_PROTOCOL_FEES_SINGLE_TOKEN_ROLE", token));
    }

    constructor(address admin) {
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function canChangeAuthorizer(address account) external view override returns (bool) {
        return hasRole(CHANGE_AUTHORIZER_ROLE, account);
    }

    function canSetProtocolWithdrawFee(address account) external view override returns (bool) {
        return hasRole(SET_PROTOCOL_WITHDRAW_FEE_ROLE, account);
    }

    function canSetProtocolSwapFee(address account) external view override returns (bool) {
        return hasRole(SET_PROTOCOL_SWAP_FEE_ROLE, account);
    }

    function canSetProtocolFlashLoanFee(address account) external view override returns (bool) {
        return hasRole(SET_PROTOCOL_FLASH_LOAN_FEE_ROLE, account);
    }

    function canWithdrawProtocolFees(address account, IERC20 token) external view override returns (bool) {
        return
            hasRole(WITHDRAW_PROTOCOL_FEES_ALL_TOKENS_ROLE, account) ||
            hasRole(WITHDRAW_PROTOCOL_FEES_SINGLE_TOKEN_ROLE(token), account);
    }
}
