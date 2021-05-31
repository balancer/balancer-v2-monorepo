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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/WordCodec.sol";

import "../BaseWeightedPool.sol";

/**
 * @dev Weighted Pool with mutable weights, designed to support V2 Liquidity Bootstrapping
 */
contract LiquidityBootstrappingPool is BaseWeightedPool, ReentrancyGuard {
    using FixedPoint for uint256;
    using WordCodec for bytes32;

    uint256 private constant _MAX_LBP_TOKENS = 4;

    // For gas optimization, store the 4 weights as uint64's in a single state variable
    bytes32 private _normalizedWeights;

    // The protocol fees will always be charged using the token associated with the max weight in the pool.
    // Not worth packing - only referenced on join/exits
    uint256 private _maxWeightTokenIndex;

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
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
            new address[](tokens.length), // Pass the zero address: LBPs can't have asset managers
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        uint256 numTokens = tokens.length;
        _require(numTokens <= _MAX_LBP_TOKENS, Errors.MAX_TOKENS);

        InputHelpers.ensureInputLengthMatch(numTokens, normalizedWeights.length);

        // Ensure each normalized weight is above the minimum and find the token index of the maximum weight
        uint256 normalizedSum = 0;
        uint256 maxWeightTokenIndex = 0;
        uint256 maxNormalizedWeight = 0;
        for (uint8 i = 0; i < numTokens; i++) {
            uint256 normalizedWeight = normalizedWeights[i];
            _require(normalizedWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            _setNormalizedWeight(normalizedWeight, i);

            normalizedSum = normalizedSum.add(normalizedWeight);
            if (normalizedWeight > maxNormalizedWeight) {
                maxWeightTokenIndex = i;
                maxNormalizedWeight = normalizedWeight;
            }
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        // Initial value; can change later if weights change
        _maxWeightTokenIndex = maxWeightTokenIndex;
    }

    function _getNormalizedWeight(IERC20 token) internal view override returns (uint256) {
        // prettier-ignore
        if (token == _token0) { return _getNormalizedWeight(0); }
        else if (token == _token1) { return _getNormalizedWeight(1); }
        else if (token == _token2) { return _getNormalizedWeight(2); }
        else if (token == _token3) { return _getNormalizedWeight(3); }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _getNormalizedWeights() internal view override returns (uint256[] memory) {
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory normalizedWeights = new uint256[](totalTokens);

        // prettier-ignore
        {
            if (totalTokens > 0) { normalizedWeights[0] = _getNormalizedWeight(0); } else { return normalizedWeights; }
            if (totalTokens > 1) { normalizedWeights[1] = _getNormalizedWeight(1); } else { return normalizedWeights; }
            if (totalTokens > 2) { normalizedWeights[2] = _getNormalizedWeight(2); } else { return normalizedWeights; }
            if (totalTokens > 3) { normalizedWeights[3] = _getNormalizedWeight(3); } else { return normalizedWeights; }
        }

        return normalizedWeights;
    }

    function _getMaxWeightTokenIndex() internal view override returns (uint256) {
        return _maxWeightTokenIndex;
    }

    // Private functions

    // Assumes i is in range
    function _setNormalizedWeight(uint256 weight, uint8 i) private {
        _normalizedWeights = _normalizedWeights.insertUint64(weight, i * 64);
    }

    // Assumes i is in range
    function _getNormalizedWeight(uint8 i) private view returns (uint256) {
        return _normalizedWeights.decodeUint64(i * 64);
    }
}
