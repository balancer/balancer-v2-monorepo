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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/IUnbuttonToken.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-linear/IAToken.sol";

import "../LinearPool.sol";

/**
 * @title UnbuttonAaveLinearPool
 *
 * @author @aalavandhan1984 (dev-support@fragments.org)
 *
 * @notice This linear pool is between any Unbutton ERC-20 (eg, wrapped AMPL)
 *         and its corresponding Unbutton aToken (eg, wrapped aaveAMPL).
 *
 * @dev In the comments we assume that the pool is between {wAMPL - wAaveAMPL};
 *      however this linear pool will support any rebasing token and its
 *      aToken counterpart both of which are wrapped using the unbutton wrapper.
 *
 *      For the {wAMPL - wAaveAMPL} pool, the exchange rate is calculated based on:
 *        - the rate between wAMPL and AMPL
 *        - the rate between AMPL and aaveAMPL
 *        - the rate between wAaveAMPL and aaveAMPL
 *
 *      Unbutton wrapper: https://github.com/buttonwood-protocol/button-wrappers/blob/main/contracts/UnbuttonToken.sol
 */
contract UnbuttonAaveLinearPool is LinearPool {
    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IUnbuttonToken mainToken,
        IUnbuttonToken wrappedToken,
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
            mainToken, // wAMPL
            wrappedToken, // wAaveAMPL
            upperTarget,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        // wAMPL.underlying() == AMPL
        address mainUnderlying = mainToken.underlying();

        // wAaveAMPL.underlying() == aaveAMPL
        // aaveAMPL.UNDERLYING_ASSET_ADDRESS() == AMPL
        address wrappedUnderlying = IAToken(wrappedToken.underlying()).UNDERLYING_ASSET_ADDRESS();

        _require(mainUnderlying == wrappedUnderlying, Errors.TOKENS_MISMATCH);
    }

    /*
     * @dev This function returns the exchange rate between the main token and
     *      the wrapped token as a 18 decimal fixed point number.
     *      In our case, it's the exchange rate between wAMPL and wAaveAMPL
     *      (i.e., the number of wAMPL for each wAaveAMPL).
     *      All UnbuttonTokens have 18 decimals, so it is not necessary to
     *      query decimals for the main token or wrapped token.
     */
    function _getWrappedTokenRate() internal view override returns (uint256) {
        // 1e18 wAaveAMPL = r1 aaveAMPL
        uint256 r1 = IUnbuttonToken(address(getWrappedToken())).wrapperToUnderlying(FixedPoint.ONE);

        // r1 aaveAMPL = r1 AMPL (AMPL and aaveAMPL have a 1:1 exchange rate)

        // r1 AMPL = r2 wAMPL
        uint256 r2 = IUnbuttonToken(address(getMainToken())).underlyingToWrapper(r1);

        // 1e18 wAaveAMPL = r2 wAMPL
        return r2;
    }
}
