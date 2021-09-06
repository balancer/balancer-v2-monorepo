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

import "@balancer-labs/v2-vault/contracts/interfaces/IAsset.sol";

import "../openzeppelin/IERC20.sol";

// solhint-disable

function _translateToIAsset(IERC20[] memory tokens) pure returns (IAsset[] memory) {
    IAsset[] memory assets = new IAsset[](tokens.length);
    for (uint256 i = 0; i < tokens.length; ++i) {
        assets[i] = IAsset(address(tokens[i]));
    }
    return assets;
}

function _sortTokens(IERC20 tokenA, IERC20 tokenB, IERC20 tokenC) pure returns (IERC20[] memory tokens) {
    (uint256 indexTokenA, uint256 indexTokenB, uint256 indexTokenC) = _getSortedTokenIndexes(tokenA, tokenB, tokenC);
    tokens = new IERC20[](3);
    tokens[indexTokenA] = tokenA;
    tokens[indexTokenB] = tokenB;
    tokens[indexTokenC] = tokenC;
}

function _getSortedTokenIndexes(IERC20 tokenA, IERC20 tokenB, IERC20 tokenC) pure returns (uint256 indexTokenA, uint256 indexTokenB, uint256 indexTokenC) {
    if (tokenA < tokenB) {
        if (tokenB < tokenC) { // (tokenA, tokenB, tokenC)
            return (0, 1, 2);
        } else if (tokenA < tokenC) { // (tokenA, tokenC, tokenB)
            return (0, 2, 1);
        } else { // (tokenC, tokenA, tokenB)
            return (1, 2, 0);
        }
    } else { // tokenB < tokenA
        if (tokenC < tokenB) {
            // (tokenC, tokenB, tokenA)
            return (2, 1, 0);
        } else if (tokenC < tokenA) {
            // (tokenB, tokenC, tokenA)
            return (2, 0, 1);
        } else {
            // (tokenB, tokenA, tokenC)
            return (1, 0, 2);
        }
    }
}
