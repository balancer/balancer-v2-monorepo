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

// Needed for struct arguments
pragma experimental ABIEncoderV2;

// Imports

import "../vendor/EnumerableSet.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "./UserBalance.sol";

// Contracts

/**
 * @title Admin - Maintain the protocol admin address, and implement privileged functions
 *        involving protocol-wide fees and universal agent managers
 * @author Balancer Labs
 */
abstract contract Admin is UserBalance {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    // State variables

    address private _admin;

    // Function declarations

    /**
     * @notice Create the Admin controller contract
     * @param admin - the privileged admin account, empowered to change fees and add/remove universal agent managers
     */
    constructor(address admin) {
        _admin = admin;
    }

    // External functions

    /**
     * @notice transfer control to a new admin
     * @param newAdmin - the address of the new admin
     */
    function transferAdmin(address newAdmin) external {
        require(msg.sender == _admin, "Caller is not the admin");

        _admin = newAdmin;
    }

    /**
     * @notice Set the destination address for protocol fees
     * @dev Fees are transferred in `withdrawProtocolFees`. Implemented in `Settings`
     *      The fee collector has no default, and must be manually set by the admin account;
     *      fees cannot be withdrawn until the recipient is set
     * @param protocolFeeCollector - the destination address for protocol fees
     */
    function setProtocolFeeCollector(address protocolFeeCollector) external {
        require(msg.sender == _admin, "Caller is not the admin");

        _setProtocolFeeCollector(protocolFeeCollector);
    }

    /**
     * @notice Set the protocol withdrawal fee
     * @dev Implemented in `Settings`, subject to `_MAX_PROTOCOL_WITHDRAW_FEE`
     * @param fee - amount of the protocol fee
     */
    function setProtocolWithdrawFee(uint128 fee) external {
        require(msg.sender == _admin, "Caller is not the admin");

        _setProtocolWithdrawFee(fee);
    }

    /**
     * @notice Set the protocol swap fee
     * @dev The protocol swap fee is a percentage of the pool swap fee (which can be zero)
     *      Implemented in `Settings`, subject to `_MAX_PROTOCOL_SWAP_FEE`
     * @param fee - the destination address for protocol fees
     */
    function setProtocolSwapFee(uint128 fee) external {
        require(msg.sender == _admin, "Caller is not the admin");

        _setProtocolSwapFee(fee);
    }

    /**
     * @notice Set the protocol flash loan fee
     * @dev The flash loan fee is a percentage of the total amount borrowed (per token).
     *      Implemented in `Settings`, subject to `_MAX_PROTOCOL_FLASH_LOAN_FEE`
     * @param fee - the destination address for protocol fees
     */
    function setProtocolFlashLoanFee(uint128 fee) external {
        require(msg.sender == _admin, "Caller is not the admin");

        _setProtocolFlashLoanFee(fee);
    }

    /**
     * @notice Add a new universal agent manager (responsible for maintaining the list of universal agents)
     * @param manager - the new universal agent manager
     */
    function addUniversalAgentManager(address manager) external override {
        require(msg.sender == _admin, "Caller is not the admin");

        _universalAgentManagers.add(manager);
    }

    /**
     * @notice Remove a universal agent manager (responsible for maintaining the list of universal agents)
     * @param manager - the new universal agent manager
     */
    function removeUniversalAgentManager(address manager) external override {
        require(msg.sender == _admin, "Caller is not the admin");

        _universalAgentManagers.remove(manager);
    }

    /**
     * @notice Cause some portion of the accumulated protocol fees to be transferred to the registered
     *         destination address
     * @dev Fee balances are stored in `Settings`; the amount available for each token is available through
     *      `getCollectedFeesByToken` in `VaultAccounting`
     * @param tokens - the list of tokens whose fees we want to collect
     * @param amounts - the amount of each token we wish to transfer (does not have to be the full amount)
     */
    function withdrawProtocolFees(IERC20[] calldata tokens, uint256[] calldata amounts) external override {
        require(tokens.length == amounts.length, "Tokens and amounts length mismatch");

        address recipient = protocolFeeCollector();
        require(recipient != address(0), "Protocol fee collector recipient is not set");

        for (uint256 i = 0; i < tokens.length; ++i) {
            require(_collectedProtocolFees[tokens[i]] >= amounts[i], "Insufficient protocol fees");
            _collectedProtocolFees[tokens[i]] = _collectedProtocolFees[tokens[i]] - amounts[i];
            tokens[i].safeTransfer(recipient, amounts[i]);
        }
    }

    // Public functions

    /**
     * @notice Getter for the privileged admin account
     * @return admin account address
     */
    function admin() public view returns (address) {
        return _admin;
    }
}
