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

interface IPoolGovernance {
    function setSwapFee(bytes32 poolID, uint256 swapFee) external;

    function setController(bytes32 poolID, address controller) external;

    function setPublicSwap(bytes32 poolID) external;

    function addInitialLiquidity(
        bytes32 poolID,
        address[] calldata initialTokens,
        uint256[] calldata amountsIn
    ) external;

    function addLiquidity(bytes32 poolID, uint256[] calldata amountsIn)
        external;

    function removeLiquidity(
        bytes32 poolID,
        address recipient,
        uint256[] calldata amountsOut
    ) external;

    function getTokenAmountsIn(
        bytes32 poolID,
        uint256 ratio,
        uint256[] calldata maxAmountsIn
    ) external returns (uint256[] memory);

    function getTokenAmountsOut(
        bytes32 poolID,
        uint256 ratio,
        uint256[] calldata minAmountsOut
    ) external returns (uint256[] memory);

    function getPoolTokenBalance(bytes32 poolID, address token)
        external
        view
        returns (uint256);

    function getPoolTokens(bytes32 poolID)
        external
        view
        returns (address[] memory);
}
