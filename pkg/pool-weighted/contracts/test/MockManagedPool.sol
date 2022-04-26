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

import "hardhat/console.sol";

contract MockManagedPool is ManagedPool {
    using FixedPoint for uint256;

    constructor(
        NewPoolParams memory params,
        IVault vault,
        address owner,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration) ManagedPool(params, vault, owner, pauseWindowDuration, bufferPeriodDuration) {    
    }

    function getTotalTokens() external view returns (uint256) {
      return _getTotalTokens();
    }

    function checkAddTokenBptAmount(
        IERC20 token,
        uint256 normalizedWeight,
        uint256 tokenAmountIn,
        address assetManager,
        uint256 minBptPrice,
        address sender,
        address recipient
    ) external {
      uint256 weightSumBeforeAdd = getDenormalizedWeightSum();
      uint256 weightSumAfterAdd = weightSumBeforeAdd.mulUp(FixedPoint.ONE.divDown(FixedPoint.ONE - normalizedWeight));
      uint256 weightSumRatio = weightSumAfterAdd.divDown(weightSumBeforeAdd);
      uint256 expectedBptAmountOut = totalSupply().mulDown(weightSumRatio.sub(FixedPoint.ONE));

      uint256 bptAmountOut = _addToken(
        token,
        normalizedWeight,
        tokenAmountIn,
        assetManager,
        minBptPrice,
        sender,
        recipient
      );

      require(bptAmountOut == expectedBptAmountOut, "BptAmountOut does not match expected");
    }
}
