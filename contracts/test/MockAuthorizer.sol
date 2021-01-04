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

import "../vault/interfaces/IAuthorizer.sol";

contract MockAuthorizer is IAuthorizer {
    bool private _canChangeAuthorizer = false;
    bool private _canSetProtocolWithdrawFee = false;
    bool private _canSetProtocolSwapFee = false;
    bool private _canSetProtocolFlashLoanFee = false;
    bool private _canCollectProtocolFees = false;
    bool private _canAddUniversalAgent = false;
    bool private _canRemoveUniversalAgent = false;

    address private _authorized;

    constructor(address authorized) {
        _authorized = authorized;
    }

    function getAuthorized() external view returns (address) {
        return _authorized;
    }

    function setAuthorized(address authorized) external {
        _authorized = authorized;
    }

    function setCanChangeAuthorizer(bool allowed) external {
        _canChangeAuthorizer = allowed;
    }

    function setCanSetProtocolWithdrawFee(bool allowed) external {
        _canSetProtocolWithdrawFee = allowed;
    }

    function setCanSetProtocolSwapFee(bool allowed) external {
        _canSetProtocolSwapFee = allowed;
    }

    function setCanSetProtocolFlashLoanFee(bool allowed) external {
        _canSetProtocolFlashLoanFee = allowed;
    }

    function setCanCollectProtocolFees(bool allowed) external {
        _canCollectProtocolFees = allowed;
    }

    function setCanAddUniversalAgent(bool allowed) external {
        _canAddUniversalAgent = allowed;
    }

    function setCanRemoveUniversalAgent(bool allowed) external {
        _canRemoveUniversalAgent = allowed;
    }

    function canChangeAuthorizer(address account) external view override returns (bool) {
        return (account == _authorized) && _canChangeAuthorizer;
    }

    function canSetProtocolWithdrawFee(address account) external view override returns (bool) {
        return (account == _authorized) && _canSetProtocolWithdrawFee;
    }

    function canSetProtocolSwapFee(address account) external view override returns (bool) {
        return (account == _authorized) && _canSetProtocolSwapFee;
    }

    function canSetProtocolFlashLoanFee(address account) external view override returns (bool) {
        return (account == _authorized) && _canSetProtocolFlashLoanFee;
    }

    function canCollectProtocolFees(address account, IERC20) external view override returns (bool) {
        return (account == _authorized) && _canCollectProtocolFees;
    }

    function canAddUniversalAgent(address account) external view override returns (bool) {
        return (account == _authorized) && _canAddUniversalAgent;
    }

    function canRemoveUniversalAgent(address account) external view override returns (bool) {
        return (account == _authorized) && _canRemoveUniversalAgent;
    }
}
