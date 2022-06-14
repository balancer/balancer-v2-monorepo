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

import "@balancer-labs/v2-pool-utils/contracts/test/MockInvariantDependency.sol";

import "../StablePhantomPool.sol";

contract MockStablePhantomPool is StablePhantomPool, MockInvariantDependency {
    constructor(NewPoolParams memory params) StablePhantomPool(params) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function mockCacheTokenRateIfNecessary(IERC20 token) external {
        _cacheTokenRateIfNecessary(token);
    }

    function getRate() public view virtual override whenInvariantConverges returns (uint256) {
        return super.getRate();
    }

    function _onSwapGivenIn(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override returns (uint256 amountOut) {
        if (request.tokenIn != IERC20(this) && request.tokenOut != IERC20(this)) {
            _ensureInvariantConverges();
        }

        return super._onSwapGivenIn(request, balancesIncludingBpt, indexIn, indexOut);
    }

    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override returns (uint256 amountIn) {
        if (request.tokenIn != IERC20(this) && request.tokenOut != IERC20(this)) {
            _ensureInvariantConverges();
        }

        return super._onSwapGivenOut(request, balancesIncludingBpt, indexIn, indexOut);
    }
}
