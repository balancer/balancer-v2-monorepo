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
import "@balancer-labs/v2-interfaces/contracts/pool-utils/ILastCreatedPoolFactory.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";

import "@balancer-labs/v2-interfaces/contracts/pool-linear/IIdleTokenV3_1.sol";

import "../LinearPoolRebalancer.sol";

contract IdleLinearPoolRebalancer is LinearPoolRebalancer {
    using SafeERC20 for IERC20;

    // These Rebalancers can only be deployed from a factory to work around a circular dependency: the Pool must know
    // the address of the Rebalancer in order to register it, and the Rebalancer must know the address of the Pool
    // during construction.
    constructor(IVault vault, IBalancerQueries queries)
        LinearPoolRebalancer(ILinearPool(ILastCreatedPoolFactory(msg.sender).getLastCreatedPool()), vault, queries)
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function _wrapTokens(uint256 amount) internal override {
        // No referral code, depositing from underlying (i.e. DAI, USDC, etc. instead of idleDAI or idleUSDC). Before we can
        // deposit however, we need to approve the wrapper in the underlying token.
        _mainToken.safeApprove(address(_wrappedToken), amount);
        IIdleTokenV3_1(address(_wrappedToken)).mintIdleToken(amount);
    }

    function _unwrapTokens(uint256 amount) internal override {
        // Withdrawing into underlying (i.e. DAI, USDC, etc. instead of idleDAI or idleUSDC). Approvals are not necessary here
        // as the wrapped token is simply burnt.
        IIdleTokenV3_1(address(_wrappedToken)).redeemIdleToken(amount);
    }

    function _getRequiredTokensToWrap(uint256 wrappedAmount) internal view override returns (uint256) {
        uint256 mainTokenDecimals = ERC20(address(_mainToken)).decimals();
        
        // Precision of Main Token Decimals
        uint256 wrappedTokenPrice = IIdleTokenV3_1(address(_wrappedToken)).tokenPrice();

        // wrappedTokenPrice * wrappedAmount will result in main token + 18 decimals
        // We divide by main token decimals to have a precision of 18 decimals
        return ((wrappedTokenPrice * wrappedAmount) / 10**mainTokenDecimals) + 1;
    }
}
