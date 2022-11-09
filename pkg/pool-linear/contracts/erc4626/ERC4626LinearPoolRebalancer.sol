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

import "@balancer-labs/v2-interfaces/contracts/solidity-utils/misc/IERC4626.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/ILastCreatedPoolFactory.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "hardhat/console.sol";

import "../LinearPoolRebalancer.sol";

contract ERC4626LinearPoolRebalancer is LinearPoolRebalancer {
    using Math for uint256;

    // These Rebalancers can only be deployed from a factory to work around a circular dependency: the Pool must know
    // the address of the Rebalancer in order to register it, and the Rebalancer must know the address of the Pool
    // during construction.
    constructor(IVault vault, IBalancerQueries queries)
        LinearPoolRebalancer(ILinearPool(ILastCreatedPoolFactory(msg.sender).getLastCreatedPool()), vault, queries)
    { 
        // solhint-disable-previous-line no-empty-blocks
    }

    function _wrapTokens(uint256 amount) internal override {
        // Depositing from underlying (i.e. DAI, USDC, etc. instead of vault tokens). Before we can
        // deposit however, we need to approve the wrapper (ERC4626 vault) in the underlying token.
        _mainToken.approve(address(_wrappedToken), amount);
        IERC4626(address(_wrappedToken)).deposit(amount, address(this));
    }

    function _unwrapTokens(uint256 wrappedAmount) internal override {
        console.log(
            "_unwrapTokens %s",
            wrappedAmount
        );
        // Withdrawing into underlying (i.e. DAI, USDC, etc. instead of vault tokens). Approvals are not necessary
        // here as the wrapped token is simply burnt.
        IERC4626(address(_wrappedToken)).redeem(wrappedAmount, address(this), address(this));
    }

    function _getRequiredTokensToWrap(uint256 wrappedAmount) internal view override returns (uint256) {
        // ERC4626 defines that previewMint MUST return as close to and no fewer than the exact amount of assets
        // (main tokens) that would be deposited to mint the desired number of shares (wrapped tokens).
        // Since the amount returned by previewMint may be slightly larger then the required number of main tokens,
        // this could result in some dust being left in the Rebalancer.
        return IERC4626(address(_wrappedToken)).previewMint(wrappedAmount);
    }
}