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

import "./BaseStablePool.sol";

contract StablePool is BaseStablePool {
    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    IERC20 internal immutable _token2;
    IERC20 internal immutable _token3;
    IERC20 internal immutable _token4;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.

    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;
    uint256 internal immutable _scalingFactor2;
    uint256 internal immutable _scalingFactor3;
    uint256 internal immutable _scalingFactor4;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 amplificationParameter,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BaseStablePool(
            vault,
            name,
            symbol,
            tokens,
            new IRateProvider[](tokens.length), // no rate providers
            new uint256[](tokens.length),      // or rate cache durations
            amplificationParameter,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        uint256 totalTokens = tokens.length;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _token0 = tokens[0];
        _token1 = tokens[1];
        _token2 = totalTokens > 2 ? tokens[2] : IERC20(0);
        _token3 = totalTokens > 3 ? tokens[3] : IERC20(0);
        _token4 = totalTokens > 4 ? tokens[4] : IERC20(0);

        _scalingFactor0 = _computeScalingFactor(tokens[0]);
        _scalingFactor1 = _computeScalingFactor(tokens[1]);
        _scalingFactor2 = totalTokens > 2 ? _computeScalingFactor(tokens[2]) : 0;
        _scalingFactor3 = totalTokens > 3 ? _computeScalingFactor(tokens[3]) : 0;
        _scalingFactor4 = totalTokens > 4 ? _computeScalingFactor(tokens[4]) : 0;
     }


    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        // prettier-ignore
        if (_isToken0(token)) { return _getScalingFactor0(); }
        else if (_isToken1(token)) { return _getScalingFactor1(); }
        else if (token == _token2) { return _getScalingFactor2(); }
        else if (token == _token3) { return _getScalingFactor3(); }
        else if (token == _token4) { return _getScalingFactor4(); }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory scalingFactors = new uint256[](totalTokens);

        // prettier-ignore
        {
            scalingFactors[0] = _getScalingFactor0();
            scalingFactors[1] = _getScalingFactor1();
            if (totalTokens > 2) { scalingFactors[2] = _getScalingFactor2(); } else { return scalingFactors; }
            if (totalTokens > 3) { scalingFactors[3] = _getScalingFactor3(); } else { return scalingFactors; }
            if (totalTokens > 4) { scalingFactors[4] = _getScalingFactor4(); } else { return scalingFactors; }
        }

        return scalingFactors;
    }

    function _isValidToken(IERC20 token) internal view virtual override returns (bool) {
        return _isToken0(token) || _isToken1(token) || _isToken2(token) || _isToken3(token) || _isToken4(token);
    }

    function _isToken0(IERC20 token) internal view override returns (bool) {
        return token == _token0;
    }

    function _isToken1(IERC20 token) internal view override returns (bool) {
        return token == _token1;
    }

    function _isToken2(IERC20 token) internal view override returns (bool) {
        return token == _token2;
    }

    function _isToken3(IERC20 token) internal view override returns (bool) {
        return token == _token3;
    }

    function _isToken4(IERC20 token) internal view override returns (bool) {
        return token == _token4;
    }

    function _getScalingFactor0() private view returns (uint256) {
        return _scalingFactor0;
    }

    function _getScalingFactor1() private view returns (uint256) {
        return _scalingFactor1;
    }

    function _getScalingFactor2() private view returns (uint256) {
        return _scalingFactor2;
    }

    function _getScalingFactor3() private view returns (uint256) {
        return _scalingFactor3;
    }

    function _getScalingFactor4() private view returns (uint256) {
        return _scalingFactor4;
    }
}
