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

import "hardhat/console.sol";

import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "../vendor/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "./Fees.sol";
import "./Agents.sol";

import "../math/FixedPoint.sol";

abstract contract InternalBalance is ReentrancyGuard, Fees, Agents {
    using SafeERC20 for IERC20;
    using FixedPoint for uint128;
    using FixedPoint for uint256;
    using SafeCast for uint256;

    // user -> token -> internal balance
    mapping(address => mapping(IERC20 => uint128)) internal _internalTokenBalance;

    event DepositedToInternalBalance(
        address indexed depositor,
        address indexed user,
        IERC20[] indexed tokens,
        uint256[] amounts
    );

    event WithdrawnFromInternalBalance(
        address indexed user,
        address indexed recipient,
        IERC20[] indexed tokens,
        uint256[] amounts
    );

    event TransferredInternalBalance(
        address indexed from,
        address indexed to,
        IERC20 indexed token,
        uint256 amount
    );

    function getInternalBalance(
        address user,
        IERC20[] memory tokens
    ) external view override returns (uint256[] memory) {
        uint256[] memory balances = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            balances[i] = _internalTokenBalance[user][tokens[i]];
        }

        return balances;
    }

    function depositToInternalBalance(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        address user
    ) external override nonReentrant {
        require(tokens.length == amounts.length, "Vault: tokens and amounts length mismatch");

        for (uint256 i = 0; i < tokens.length; i++) {
            // memoize to save gas
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];

            token.safeTransferFrom(msg.sender, address(this), amount);

            _internalTokenBalance[user][token] = _internalTokenBalance[user][token].add128(amount.toUint128());
        }
        
        emit DepositedToInternalBalance(msg.sender, user, tokens, amounts);
   }

    function withdrawFromInternalBalance(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        address recipient
    ) external override nonReentrant {
        require(tokens.length == amounts.length, "Vault: tokens and amounts length mismatch");

        for (uint256 i = 0; i < tokens.length; i++) {
            // memoize to save gas
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];

            require(_internalTokenBalance[msg.sender][token] >= amount, "Vault: withdraw amount exceeds balance");

            _internalTokenBalance[msg.sender][token] -= amount.toUint128();

            uint128 feeAmount = _calculateProtocolWithdrawFeeAmount(amount.toUint128());

            _collectedProtocolFees[token] = _collectedProtocolFees[token].add(feeAmount);
            token.safeTransfer(recipient, amount.sub(feeAmount));
        }
 
        emit WithdrawnFromInternalBalance(msg.sender, recipient, tokens, amounts);
    }

    function transferInternalBalance(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        address recipient
    ) external override nonReentrant {
        require(tokens.length == amounts.length, "Vault: tokens and amounts length mismatch");

        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20 token = tokens[i];
            uint128 currentBalance = _internalTokenBalance[msg.sender][token];
            uint128 amount = amounts[i].toUint128();

            require(amount <= currentBalance, "ERR_NOT_ENOUGH_INTERNAL_BALANCE");

            _internalTokenBalance[msg.sender][token] = currentBalance - amount;
            _internalTokenBalance[recipient][token] = _internalTokenBalance[recipient][token].add128(amount);

            emit TransferredInternalBalance(msg.sender, recipient, token, amount);
         }       
    }
}
