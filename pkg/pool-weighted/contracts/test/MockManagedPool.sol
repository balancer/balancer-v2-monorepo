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
pragma experimental ABIEncoderV2;

import "../smart/ManagedPool.sol";

contract MockManagedPool is ManagedPool {
    using FixedPoint for uint256;

    constructor(NewPoolParams memory params) ManagedPool(params) {}

    function getTotalTokens() external view returns (uint256) {
      return _getTotalTokens();
    }

    function checkRemoveTokenBptAmount(uint256 tokenIndex, address recipient) external {
      uint256[] memory weights = _getNormalizedWeights();
      uint256 expected = weights[tokenIndex].mulDown(totalSupply());
      uint256 bptAmountIn = _removeToken(tokenIndex, recipient);

      require(bptAmountIn == expected, "BptAmountIn does not match expected");
    }
}
