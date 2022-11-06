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

//import "@balancer-labs/v2-interfaces/contracts/pool-linear/IStaticAToken.sol";
import "./ICToken.sol";

import "../LinearPool.sol";

contract CompoundLinearPool is LinearPool {
    ICToken private immutable _cToken;

    struct ConstructorArgs {
        IVault vault;
        string name;
        string symbol;
        IERC20 mainToken;
        IERC20 wrappedToken;
        address assetManager;
        uint256 upperTarget;
        uint256 swapFeePercentage;
        uint256 pauseWindowDuration;
        uint256 bufferPeriodDuration;
        address owner;
    }

    constructor(ConstructorArgs memory args)
        LinearPool(
            args.vault,
            args.name,
            args.symbol,
            args.mainToken,
            args.wrappedToken,
            args.upperTarget,
            _toAssetManagerArray(args),
            args.swapFeePercentage,
            args.pauseWindowDuration,
            args.bufferPeriodDuration,
            args.owner
        )
    {
        //_lendingPool = ICToken(address(args.wrappedToken)).LENDING_POOL();
        _cToken = ICToken(address(args.wrappedToken));
        _require(address(args.mainToken) == ICToken(address(args.wrappedToken)).ASSET(), Errors.TOKENS_MISMATCH);
    }

    function _toAssetManagerArray(ConstructorArgs memory args) private pure returns (address[] memory) {
        // We assign the same asset manager to both the main and wrapped tokens.
        address[] memory assetManagers = new address[](2);
        assetManagers[0] = args.assetManager;
        assetManagers[1] = args.assetManager;

        return assetManagers;
    }

    // Returns a 18 decimal fixed point number
    function _getWrappedTokenRate() internal view override returns (uint256) {
        // Calculate the decimal adjustment to produce a 18 decimal fixed point number
        // Rate is scaled by 1*10^(18 - 8 + token decimals)
        uint256 decimalDiff = 18 - (10 + 8);

        uint256 rate = _cToken.exchangeRateCurrent();

        // Convert rate to get proper output
        return rate / 10**decimalDiff;
    }
}
