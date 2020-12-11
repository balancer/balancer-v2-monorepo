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

import "../math/FixedPoint.sol";

import "../vendor/EnumerableSet.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "./IVault.sol";
import "./Settings.sol";
import "./UserBalance.sol";

abstract contract Admin is IVault, Settings, UserBalance {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    address private _admin;

    modifier onlyAdmin() {
        _validateAdmin(msg.sender);
        _;
    }

    constructor(address admin) {
        _admin = admin;
    }

    function admin() public view returns (address) {
        return _admin;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        _admin = newAdmin;
    }

    function setProtocolFeeCollector(address protocolFeeCollector) external onlyAdmin {
        _setProtocolFeeCollector(protocolFeeCollector);
    }

    function setProtocolWithdrawFee(uint128 fee) external onlyAdmin {
        _setProtocolWithdrawFee(fee);
    }

    function setProtocolSwapFee(uint128 fee) external onlyAdmin {
        _setProtocolSwapFee(fee);
    }

    function setProtocolFlashLoanFee(uint128 fee) external onlyAdmin {
        _setProtocolFlashLoanFee(fee);
    }

    function authorizeTrustedOperatorReporter(address reporter) external override onlyAdmin {
        _trustedOperatorReporters.add(reporter);
    }

    function revokeTrustedOperatorReporter(address reporter) external override {
        _validateAdmin(msg.sender);

        _trustedOperatorReporters.remove(reporter);
    }

    function withdrawProtocolFees(IERC20[] calldata tokens, uint256[] calldata amounts) external override {
        require(tokens.length == amounts.length, "INVALID_TOKEN_AMOUNTS_LENGTH");

        address recipient = protocolFeeCollector();
        require(recipient != address(0), "PROTOCOL_FEE_COLLECTOR_NOT_SET");

        for (uint256 i = 0; i < tokens.length; ++i) {
            require(_collectedProtocolFees[tokens[i]] >= amounts[i], "Insufficient protocol fees");
            _collectedProtocolFees[tokens[i]] = _collectedProtocolFees[tokens[i]] - amounts[i];
            tokens[i].safeTransfer(recipient, amounts[i]);
        }
    }

    function _validateAdmin(address account) internal view {
        require(account == _admin, "SENDER_NOT_ADMIN");
    }
}
