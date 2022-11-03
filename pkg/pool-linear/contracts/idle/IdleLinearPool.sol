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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/IIdleTokenV3_1.sol";

import "../LinearPool.sol";

contract IdleLinearPool is LinearPool {
    using Math for uint256;

    uint256 private immutable _rateScaleFactor;

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
        // We do NOT enforce mainToken == wrappedToken.asset() even
        // though this is the expected behavior in most cases. Instead,
        // we assume a 1:1 relationship between mainToken and
        // wrappedToken.asset(), but they do not have to be the same
        // token. It is vitally important that this 1:1 relationship is
        // respected, or the pool will not function as intended.
        //
        // This allows for use cases where the wrappedToken is
        // double-wrapped into an $IDLE token. For example, consider
        // a linear pool whose goal is to pair DAI with idleDAI. Because
        // idleDAI is a rebasing token, it needs to be wrapped, and let's
        // say an $IDLE wrapper is chosen for compatibility with this
        // linear pool. Then wrappedToken.asset() will return idleDAI,
        // whereas mainToken is DAI. But the 1:1 relationship holds, and
        // the pool is still valid.

        // _getWrappedTokenRate is scaled e18, but tokenPrice() is scaled according to mainToken decimals.
        // Therefore, we need to scale tokenPrice result to have 1e18 decimals.
        _require(address(args.mainToken) == IIdleTokenV3_1(address(args.wrappedToken)).token(), Errors.TOKENS_MISMATCH);
        
        uint256 mainTokenDecimals = ERC20(address(args.mainToken)).decimals();

        // This is always positive because we only accept tokens with <= 18 decimals
        uint256 digitsDifference = Math.sub(18, mainTokenDecimals);
        _rateScaleFactor = 10**digitsDifference;
    }

    function _toAssetManagerArray(ConstructorArgs memory args) private pure returns (address[] memory) {
        // We assign the same asset manager to both the main and wrapped tokens.
        address[] memory assetManagers = new address[](2);
        assetManagers[0] = args.assetManager;
        assetManagers[1] = args.assetManager;

        return assetManagers;
    }

    function _getWrappedTokenRate() internal view override returns (uint256) {
        IIdleTokenV3_1 wrappedToken = IIdleTokenV3_1(address(getWrappedToken()));
        return wrappedToken.tokenPrice() * _rateScaleFactor;
    }
}
