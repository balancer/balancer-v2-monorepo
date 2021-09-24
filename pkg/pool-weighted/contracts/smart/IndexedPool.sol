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

import "../BaseWeightedPool.sol";

/**
 * @dev Basic Weighted Pool with immutable weights.
 */
contract IndexedPool is BaseWeightedPool {
    using FixedPoint for uint256;

    uint256 private constant _MAX_TOKENS = 50;

    uint256 private immutable _totalTokens;

    IERC20[] internal _tokens;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.
    uint256[] internal scalingFactors;

    // The protocol fees will always be charged using the token associated with the max weight in the pool.
    // Since these Pools will register tokens only once, we can assume this index will be constant.
    uint256 internal immutable _maxWeightTokenIndex;

    uint256[] internal _normalizedWeights;


    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
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
            owner
        )
    {
        uint256 numTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(numTokens, normalizedWeights.length);

        _totalTokens = numTokens;

        // Ensure  each normalized weight is above them minimum and find the token index of the maximum weight
        uint256 normalizedSum = 0;
        uint256 maxWeightTokenIndex = 0;
        uint256 maxNormalizedWeight = 0;
        for (uint8 i = 0; i < numTokens; i++) {
            uint256 normalizedWeight = normalizedWeights[i];
            _require(normalizedWeight >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

            normalizedSum = normalizedSum.add(normalizedWeight);
            if (normalizedWeight > maxNormalizedWeight) {
                maxWeightTokenIndex = i;
                maxNormalizedWeight = normalizedWeight;
            }
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _maxWeightTokenIndex = maxWeightTokenIndex;

        _normalizedWeights = normalizedWeights;
        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _tokens = tokens;

        for(uint i = 0; i < numTokens; i++){
            scalingFactors.push(_computeScalingFactor(tokens[i]););
        }
    }

    function _getNormalizedWeight(IERC20 token) internal view virtual override returns (uint256) {
        // prettier-ignore
        for(uint i = 0; i < _tokens.length; i++){
            if (token == _tokens[i]) {
                return _normalizedWeights[i];
            }
        }
        _revert(Errors.INVALID_TOKEN);
    }

    function _getNormalizedWeights() internal view virtual override returns (uint256[] memory) {
        return _normalizedWeights;
    }

    function _getNormalizedWeightsAndMaxWeightIndex()
        internal
        view
        virtual
        override
        returns (uint256[] memory, uint256)
    {
        return (_getNormalizedWeights(), _maxWeightTokenIndex);
    }

    function _getMaxTokens() internal pure virtual override returns (uint256) {
        return _MAX_TOKENS;
    }

    function _getTotalTokens() internal view virtual override returns (uint256) {
        return _totalTokens;
    }

    /**
     * @dev Returns the scaling factor for one of the Pool's tokens. Reverts if `token` is not a token registered by the
     * Pool.
     */
    function _scalingFactor(IERC20 token) internal view virtual override returns (uint256) {
        // prettier-ignore
        for(uint i = 0; i < _tokens.length; i++){
            if (token == _tokens[i]) {
                return _scalingFactor[i];
            }
        }

        _revert(Errors.INVALID_TOKEN);

    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        return scalingFactors;
    }
}
