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

import "../LinearPool.sol";

contract ReaperLinearPool is LinearPool {
    IReaperTokenVault private immutable _tokenVault;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20 mainToken,
        IERC20 wrappedToken,
        uint256 upperTarget,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        LinearPool(
            vault,
            name,
            symbol,
            mainToken,
            wrappedToken,
            upperTarget,
            new address[](2),
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        _tokenVault = IReaperTokenVault(address(wrappedToken));
        _require(address(mainToken) == IReaperTokenVault(address(wrappedToken)).token(), Errors.TOKENS_MISMATCH);
    }

    /**
     * Reaper vault tokens are always 18 decimal places, but are stored in the precision of the mainToken
     * ie: If ppfs === 1e18, 1 USDC === 0.000_000_000_001_000_000 rfUSDC
     * ie: If ppfs === 1e18, 1 DAI === 1 rfDAI
     * ie: If ppfs === 1e18, 1 WBTC === 0.000_000_000_100_000_000 rfWBTC
     * -----------
     * Internally, the LinearPool scales all balances and rates up to 18 decimal places, meaning that 1 USDC is 
     * represented as 1e18 by the LinearPool. Since the rfUSDC is already 18 decimals,
     * but in a different representation,we need to account for that in our wrappedTokenRate.
     */
    function _getWrappedTokenRate() internal view override returns (uint256) {
        ERC20 underlying = ERC20(_tokenVault.token());
        uint256 underlyingDecimals = underlying.decimals();

        uint256 sharePrice = _tokenVault.getPricePerFullShare();
        if (underlyingDecimals > 18) {
            // scale down to 18
            return sharePrice / 10**(underlyingDecimals - 18);
        } else if (underlyingDecimals < 18) {
            //we need to scale the ppfs up by 18 - underlyingDecimals
            //ie: for USDC we would scaled up by 1e12
            return sharePrice * 10**(18 - underlyingDecimals);
        }

        return sharePrice;
    }
}