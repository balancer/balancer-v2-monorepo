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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../vendor/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../math/FixedPoint.sol";

import "../strategies/ITradingStrategy.sol";
import "../strategies/IPairTradingStrategy.sol";
import "../strategies/ITupleTradingStrategy.sol";

import "./IVault.sol";
import "./VaultAccounting.sol";
import "./PoolRegistry.sol";
import "./Settings.sol";
import "./Swaps.sol";
import "./Admin.sol";
import "./UserBalance.sol";

contract Vault is
    IVault,
    Settings,
    VaultAccounting,
    UserBalance,
    PoolRegistry,
    Swaps,
    Admin
{
    constructor() Admin(msg.sender) {}
}
