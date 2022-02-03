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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";

import "../interfaces/IERC4626.sol";

import "../LinearPool.sol";

contract ERC4626LinearPool is LinearPool {
    uint256 immutable _wrappedTokenRateScale;

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
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        _require(address(mainToken) == IERC4626(address(wrappedToken)).underlying(), Errors.TOKENS_MISMATCH);

        // _getWrappedTokenRate is scaled e18, we may need to scale the assetsPerShare (in terms of token decimals)
        uint256 tokenDecimals = ERC20(address(wrappedToken)).decimals();
        uint256 decimalsDifference = Math.sub(18, tokenDecimals);
        _wrappedTokenRateScale = 10 ** decimalsDifference;
    }

    function _getWrappedTokenRate() internal view override returns (uint256) {
        // Rate between wrapped and their underlying token at _wrappedToken.decimals() scale
        uint256 rate = IERC4626(getWrappedToken()).assetsPerShare();

        // Upscale to e18
        return rate * _wrappedTokenRateScale;
    }
}
