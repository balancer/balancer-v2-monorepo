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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/IYearnTokenVault.sol";

import "../LinearPool.sol";

contract YearnLinearPool is LinearPool {
    IYearnTokenVault private immutable _tokenVault;

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
        IYearnTokenVault tokenVault = IYearnTokenVault(address(args.wrappedToken));
        
        _tokenVault = tokenVault;

        _require(address(args.mainToken) == tokenVault.token(), Errors.TOKENS_MISMATCH);
    }

    function _toAssetManagerArray(ConstructorArgs memory args) private pure returns (address[] memory) {
        // We assign the same asset manager to both the main and wrapped tokens.
        address[] memory assetManagers = new address[](2);
        assetManagers[0] = args.assetManager;
        assetManagers[1] = args.assetManager;

        return assetManagers;
    }

    //_getWrappedTokenRate is expected to return the rate scaled to 18 decimal points, regardless of underlying decimals
    function _getWrappedTokenRate() internal view override returns (uint256) {
        //the decimals of the vault token reflect that of the mainToken. So a USDC token vault has decimals = 6
        uint8 vaultDecimals = _tokenVault.decimals();
        uint256 pps = _tokenVault.pricePerShare();

        if (vaultDecimals > 18) {
            //scale down to 18
            return pps / 10**(vaultDecimals - 18);
        }else if (vaultDecimals < 18) {
            //scale up to 18
            return pps * 10**(18 - vaultDecimals);
        }

        return pps;
    }
}