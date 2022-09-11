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

import "@balancer-labs/v2-pool-utils/contracts/test/MockFailureModes.sol";

import "../ComposableStablePool.sol";

contract MockComposableStablePool is ComposableStablePool, MockFailureModes {
    constructor(NewPoolParams memory params) ComposableStablePool(params) {
        // solhint-disable-previous-line no-empty-blocks
    }

    function mockCacheTokenRateIfNecessary(uint256 index) external {
        _cacheTokenRateIfNecessary(index);
    }

    function isOwnerOnlyAction(bytes32 actionId) external view returns (bool) {
        return _isOwnerOnlyAction(actionId);
    }

    function _updateTokenRateCache(
        uint256 index,
        IRateProvider provider,
        uint256 duration
    ) internal override whenNotInFailureMode(FailureMode.PRICE_RATE) {
        return super._updateTokenRateCache(index, provider, duration);
    }

    function _onSwapGivenIn(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override whenNotInFailureMode(FailureMode.INVARIANT) returns (uint256 amountOut) {
        return super._onSwapGivenIn(request, balancesIncludingBpt, indexIn, indexOut);
    }

    function _onSwapGivenOut(
        SwapRequest memory request,
        uint256[] memory balancesIncludingBpt,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override whenNotInFailureMode(FailureMode.INVARIANT) returns (uint256 amountIn) {
        return super._onSwapGivenOut(request, balancesIncludingBpt, indexIn, indexOut);
    }

    function beforeJoinExit(uint256[] memory registeredBalances)
        external
        returns (
            uint256 preJoinExitSupply,
            uint256[] memory balances,
            uint256 currentAmp,
            uint256 preJoinExitInvariant
        )
    {
        return _beforeJoinExit(registeredBalances);
    }

    function getVirtualSupply() external view returns (uint256) {
        // For a 3 token General Pool, it is cheaper to query the balance for a single token than to read all balances,
        // as getPoolTokenInfo will check for token existence, token balance and Asset Manager (3 reads), while
        // getPoolTokens will read the number of tokens, their addresses and balances (7 reads).
        // The more tokens the Pool has, the more expensive `getPoolTokens` becomes, while `getPoolTokenInfo`'s gas
        // remains constant.
        (uint256 cash, uint256 managed, , ) = getVault().getPoolTokenInfo(getPoolId(), IERC20(this));

        // Note that unlike all other balances, the Vault's BPT balance does not need scaling as its scaling factor is
        // ONE. This addition cannot overflow due to the Vault's balance limits.
        return _getVirtualSupply(cash + managed);
    }
}
