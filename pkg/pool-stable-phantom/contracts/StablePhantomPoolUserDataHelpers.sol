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

import "./StablePhantomPool.sol";

library StablePhantomPoolUserDataHelpers {
    function joinKind(bytes memory self) internal pure returns (StablePhantomPool.JoinKindPhantom) {
        return abi.decode(self, (StablePhantomPool.JoinKindPhantom));
    }

    function exitKind(bytes memory self) internal pure returns (StablePhantomPool.ExitKindPhantom) {
        return abi.decode(self, (StablePhantomPool.ExitKindPhantom));
    }

    // Joins

    function initialAmountsIn(bytes memory self) internal pure returns (uint256[] memory amountsIn) {
        (, amountsIn) = abi.decode(self, (StablePhantomPool.JoinKindPhantom, uint256[]));
    }

    // Exits

    function exactBptInForTokensOut(bytes memory self) internal pure returns (uint256 bptAmountIn) {
        (, bptAmountIn) = abi.decode(self, (StablePhantomPool.ExitKindPhantom, uint256));
    }
}
