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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/ISToken.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/ILastCreatedPoolFactory.sol";

import "../LinearPoolRebalancer.sol";

contract SturdyLinearPoolRebalancer is LinearPoolRebalancer {
    // These Rebalancers can only be deployed from a factory to work around a circular dependency: the Pool must know
    // the address of the Rebalancer in order to register it, and the Rebalancer must know the address of the Pool
    // during construction.
    constructor(IVault vault, IBalancerQueries queries)
        LinearPoolRebalancer(ILinearPool(ILastCreatedPoolFactory(msg.sender).getLastCreatedPool()), vault, queries)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function _wrapTokens(uint256 amount) internal override {
        // No referral code, depositing from underlying (i.e. DAI, USDC, etc. instead of aDAI or aUSDC). Before we can
        // deposit however, we need to approve the lending pool in the underlying token.
        ILendingPool _lendingPool = ISToken(address(_wrappedToken)).POOL();
        _mainToken.approve(address(_lendingPool), amount);
        _lendingPool.deposit(address(_mainToken), amount, address(this), 0);
    }

    function _unwrapTokens(uint256 amount) internal override {
        // Withdrawing into underlying (i.e. DAI, USDC, etc. instead of aDAI or aUSDC). Approvals are not necessary here
        // as the wrapped token is simply burnt.
        ILendingPool _lendingPool = ISToken(address(_wrappedToken)).POOL();
        _lendingPool.withdraw(address(_mainToken), amount, address(this));
    }

    function _getRequiredTokensToWrap(uint256 wrappedAmount) internal view override returns (uint256) {
        // this returns how many main tokens will be returned when unwrapping. Since there's fixed point
        // divisions and multiplications with rounding involved, this value might be off by one. We add one to ensure
        // the returned value will always be enough to get `wrappedAmount` when unwrapping. This might result in some
        // dust being left in the Rebalancer.
        ILendingPool _lendingPool = ISToken(address(_wrappedToken)).POOL();
        uint256 rate = _lendingPool.getReserveNormalizedIncome(address(_mainToken));

        return (wrappedAmount * rate + 1e27 / 2) / 1e27 + 1;
    }
}
