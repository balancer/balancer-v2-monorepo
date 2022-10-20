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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/IReaperTokenVault.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/ILastCreatedPoolFactory.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";

import "../LinearPoolRebalancer.sol";

contract ReaperLinearPoolRebalancer is LinearPoolRebalancer {
    using Math for uint256;
    using SafeERC20 for IERC20;

    uint256 private immutable _divisor;

    // These Rebalancers can only be deployed from a factory to work around a circular dependency: the Pool must know
    // the address of the Rebalancer in order to register it, and the Rebalancer must know the address of the Pool
    // during construction.
    constructor(IVault vault, IBalancerQueries queries)
        LinearPoolRebalancer(ILinearPool(ILastCreatedPoolFactory(msg.sender).getLastCreatedPool()), vault, queries)
    {
        IERC20 wrappedToken = ILinearPool(ILastCreatedPoolFactory(msg.sender).getLastCreatedPool()).getWrappedToken();

        _divisor = 10**IReaperTokenVault(address(wrappedToken)).decimals();
    }

    function _wrapTokens(uint256 amount) internal override {
        // Depositing from underlying (i.e. DAI, USDC, etc. instead of rfDAI or rfUSDC). Before we can
        // deposit however, we need to approve the wrapper (reaper vault) in the underlying token.
        _mainToken.safeApprove(address(_wrappedToken), amount);
        IReaperTokenVault(address(_wrappedToken)).deposit(amount);
    }

    function _unwrapTokens(uint256 amount) internal override {
        // Withdrawing into underlying (i.e. DAI, USDC, etc. instead of rfDAI or rfUSDC). Approvals are not necessary
        // here as the wrapped token is simply burnt.
        IReaperTokenVault(address(_wrappedToken)).withdraw(amount);
    }

    function _getRequiredTokensToWrap(uint256 wrappedAmount) internal view override returns (uint256) {
        // We round up to ensure the returned value will always be enough to get `wrappedAmount` when unwrapping.
        // This might result in some dust being left in the Rebalancer.
        // wrappedAmount * pricePerFullShare / 10^decimals
        return wrappedAmount.mul(IReaperTokenVault(address(_wrappedToken)).getPricePerFullShare()).divUp(_divisor);
    }
}
