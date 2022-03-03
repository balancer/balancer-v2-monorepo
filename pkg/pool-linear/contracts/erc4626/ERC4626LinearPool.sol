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
import "@balancer-labs/v2-solidity-utils/contracts/misc/IERC4626.sol";

import "../LinearPool.sol";

contract ERC4626LinearPool is LinearPool {
    using Math for uint256;

    uint256 private immutable _wrappedTokenRateScale;

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
        // We do NOT enforce mainToken == wrappedToken.asset() even
        // though this is the expected behavior in most cases. Instead,
        // we assume a 1:1 relationship between mainToken and
        // wrappedToken.asset(), but they do not have to be the same
        // token. It is vitally important that this 1:1 relationship is
        // respected, or the pool will not function as intended.
        //
        // This allows for use cases where the wrappedToken is
        // double-wrapped into an ERC-4626 token. For example, consider
        // a linear pool whose goal is to pair DAI with aDAI. Because
        // aDAI is a rebasing token, it needs to be wrapped, and let's
        // say an ERC-4626 wrapper is chosen for compatibility with this
        // linear pool. Then wrappedToken.asset() will return aDAI,
        // whereas mainToken is DAI. But the 1:1 relationship holds, and
        // the pool is still valid.

        // _getWrappedTokenRate is scaled e18, so we may need to scale totalAssets/totalSupply
        uint256 wrappedTokenDecimals = ERC20(address(wrappedToken)).decimals();
        uint256 mainTokenDecimals = ERC20(address(mainToken)).decimals();
        uint256 digitsDifference = Math.add(18, wrappedTokenDecimals).sub(mainTokenDecimals);
        _wrappedTokenRateScale = 10**digitsDifference;
    }

    function _getWrappedTokenRate() internal view override returns (uint256) {
        address wrappedToken = getWrappedToken();

        // At _mainToken.decimals() precision, potentially may be ZERO
        uint256 totalMain = IERC4626(wrappedToken).totalAssets();

        // At _wrappedToken.decimals() precision, potentially may be ZERO
        uint256 totalWrapped = ERC20(wrappedToken).totalSupply();

        // On empty pool return 1:1 rate
        if (totalMain == 0 || totalWrapped == 0) {
            return FixedPoint.ONE;
        }

        // This function returns a 18 decimal fixed point number
        uint256 rate = _wrappedTokenRateScale.mul(totalMain).divDown(totalWrapped);
        return rate;
    }
}
