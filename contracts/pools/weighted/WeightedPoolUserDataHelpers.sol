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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./WeightedPool.sol";

library WeightedPoolUserDataHelpers {
    function joinKind(bytes memory self) internal pure returns (WeightedPool.JoinKind) {
        return abi.decode(self, (WeightedPool.JoinKind));
    }

    function exitKind(bytes memory self) internal pure returns (WeightedPool.ExitKind) {
        return abi.decode(self, (WeightedPool.ExitKind));
    }

    function initialAmountsIn(bytes memory self) internal pure returns (uint256[] memory amountsIn) {
        WeightedPool.JoinKind kind = joinKind(self);
        require(kind == WeightedPool.JoinKind.INIT, "UNINITIALIZED");
        (, amountsIn) = abi.decode(self, (WeightedPool.JoinKind, uint256[]));
    }

    function exactTokensInForBPTOut(bytes memory self)
        internal
        pure
        returns (uint256[] memory amountsIn, uint256 minBPTAmountIn)
    {
        (, amountsIn, minBPTAmountIn) = abi.decode(self, (WeightedPool.JoinKind, uint256[], uint256));
    }

    function tokenInForExactBPTOut(bytes memory self) internal pure returns (uint256 bptAmountOut, uint256 tokenIndex) {
        (, bptAmountOut, tokenIndex) = abi.decode(self, (WeightedPool.JoinKind, uint256, uint256));
    }

    function exactBPTInForOneTokenOut(bytes memory self)
        internal
        pure
        returns (uint256 bptAmountIn, uint256 tokenIndex)
    {
        (, bptAmountIn, tokenIndex) = abi.decode(self, (WeightedPool.ExitKind, uint256, uint256));
    }

    function exactBPTInForAllTokensOut(bytes memory self) internal pure returns (uint256 bptAmountIn) {
        (, bptAmountIn) = abi.decode(self, (WeightedPool.ExitKind, uint256));
    }

    function exitBPTInForExactTokensOut(bytes memory self)
        internal
        pure
        returns (uint256[] memory amountsOut, uint256 maxBPTAmountIn)
    {
        (, amountsOut, maxBPTAmountIn) = abi.decode(self, (WeightedPool.ExitKind, uint256[], uint256));
    }
}
