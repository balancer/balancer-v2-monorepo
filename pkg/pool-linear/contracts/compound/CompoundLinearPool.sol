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
    ERC20 private immutable _mainToken;

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
        // Set values for state variables
        _cToken = ICToken(address(args.wrappedToken));
        _mainToken = ERC20(address(args.mainToken));

        // Check to make sure that the main token is the underlying token for the wrapped Token
        _require(address(args.mainToken) == ICToken(address(args.wrappedToken)).underlying(), Errors.TOKENS_MISMATCH);
    }

    function _toAssetManagerArray(ConstructorArgs memory args) private pure returns (address[] memory) {
        // We assign the same asset manager to both the main and wrapped tokens.
        address[] memory assetManagers = new address[](2);
        assetManagers[0] = args.assetManager;
        assetManagers[1] = args.assetManager;

        return assetManagers;
    }

    // Wrapped token rate is the exchange rate for 1 wrappedToken in main tokens.
    // This function needs to return a 18 decimal fixed point number in order to incorporate properly with the Linear Pool & Linear Pool Math Contracts
    function _getWrappedTokenRate() internal view override returns (uint256) {
        uint256 rate = _cToken.exchangeRateStored();
        // _cToken.exchangeRateStored() returns a integer that is scaled by 10 ** (18 - 8 + underlying token decimals)
        // The underlying tokens available to be traded with compound have a range of decimals between 6 and 18
        // This causes a rate variable that can be anywhere from a 16 to a 28 decimal fixed point number
        // We set this formula as our initial scaling value to begin the conversion to the return value
        uint256 compoundScaling = SafeMath.add(10, _mainToken.decimals());
        // We subtract 18 from our compound scaling variable to determine how far we are off from a formula to will produce a 18 fixed point number
        // SafeMath not needed because we are not dealing with external inputs
        int256 finalScaling = int256(compoundScaling) - 18;

        // Solidity does not allow us to calculate exponential value with a negative number so we must have two separate return statements
        // The final scaling value must be converted to a uint256 due to our return requirements
        // An absolute value function was created to handle this type conversion due to potential negative integers
        if (finalScaling < 0) {
            return rate * 10**abs(finalScaling);
        } else {
            return rate / 10**abs(finalScaling);
        }

    }

    // Returns the absolute value of a int256 and converts to a uint256
    function abs(int256 number) private pure returns (uint256) {
        return number >=0 ? uint256(number) : uint256(-number);
    }



}
