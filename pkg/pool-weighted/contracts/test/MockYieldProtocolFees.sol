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

import "../YieldProtocolFees.sol";

contract MockYieldProtocolFees is YieldProtocolFees {
    uint256 private immutable _totalTokens;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        IRateProvider[] memory rateProviders,
        address[] memory assetManagers,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BaseWeightedPool(
            vault,
            name,
            symbol,
            tokens,
            assetManagers,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner,
            false
        )
        YieldProtocolFees(tokens.length, rateProviders)
    {
        _totalTokens = tokens.length;
    }

    // Stubbed functions

    function _getMaxTokens() internal pure virtual override returns (uint256) {
        return 8;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _totalTokens;
    }

    function _getNormalizedWeight(IERC20) internal view virtual override returns (uint256) {
        revert("NOT_IMPLEMENTED");
    }

    function _getNormalizedWeights() internal view virtual override returns (uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }

    function _scalingFactor(IERC20) internal view virtual override returns (uint256) {
        revert("NOT_IMPLEMENTED");
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        revert("NOT_IMPLEMENTED");
    }
}
