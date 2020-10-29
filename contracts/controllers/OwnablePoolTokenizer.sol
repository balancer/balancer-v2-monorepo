// // SPDX-License-Identifier: GPL-3.0-or-later
// // This program is free software: you can redistribute it and/or modify
// // it under the terms of the GNU General Public License as published by
// // the Free Software Foundation, either version 3 of the License, or
// // (at your option) any later version.

// // This program is distributed in the hope that it will be useful,
// // but WITHOUT ANY WARRANTY; without even the implied warranty of
// // MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// // GNU General Public License for more details.

// // You should have received a copy of the GNU General Public License
// // along with this program.  If not, see <http://www.gnu.org/licenses/>.

// pragma solidity ^0.7.1;

// import "./BasePoolTokenizer.sol";

// // Initial implementation implements a simple, pass-through sole proprietorship model
// // for pool governance
// contract OwnablePoolTokenizer is BasePoolTokenizer {
//     address public owner;

//     constructor(IVault _vault, bytes32 _poolID) BasePoolTokenizer(_vault) {
//         poolID = _poolID;
//         owner = msg.sender;
//     }

//     modifier onlyOwner() {
//         require(msg.sender == owner, "Must be the contract owner");
//         _;
//     }

//     // Add the initial liquidity to a pool
//     function initPool(
//         uint256 initialBPT,
//         address[] calldata initialTokens,
//         uint256[] calldata initialBalances
//     ) external onlyOwner {
//         require(totalSupply() == 0, "POOL ALREADY INITIALIZED");
//         require(msg.sender == owner, "MUST BE OWNER");

//         _addInitialLiquidity(initialBPT, initialTokens, initialBalances);
//     }

//     // Governance functions
//     function setOwner(address newOwner) public onlyOwner {
//         owner = newOwner;
//     }

//     function setController(address manager) public onlyOwner {
//         vault.setController(poolID, manager);
//     }
// }
