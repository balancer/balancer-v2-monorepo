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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/IStaticAToken.sol";

import "../LinearPoolRebalancer.sol";

contract AaveLinearPoolRebalancer is LinearPoolRebalancer {
    constructor(
        ILinearPool pool,
        IVault vault,
        IBalancerQueries queries
    ) LinearPoolRebalancer(pool, vault, queries) {}

    function _wrapTokens(uint256 amount) internal override {
        // No referral code, depositing from underlying (i.e. DAI, USDC, etc. instead of aDAI or aUSDC).
        IStaticAToken(address(_wrappedToken)).deposit(address(this), amount, 0, true);
    }

    function _unwrapTokens(uint256 amount) internal override {
        // Withdrawing into underlying (i.e. DAI, USDC, etc. instead of aDAI or aUSDC).
        IStaticAToken(address(_wrappedToken)).withdraw(address(this), amount, true);
    }

    function _getRequiredTokensToWrap(uint256 wrappedAmount) internal view override returns (uint256) {
        // staticToDynamic returns how many main tokens will be returned when unwrapping. Since there's fixed point
        // divisions and multiplications with rounding involved, this value might be off by one. We add one to ensure
        // the returned value will always be enough to get `wrappedAmount` when unwrapping. This might result in some
        // dust being left in the Rebalancer.
        return IStaticAToken(address(_wrappedToken)).staticToDynamicAmount(wrappedAmount) + 1;
    }
}
