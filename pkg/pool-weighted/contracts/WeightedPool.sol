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

import "./BaseWeightedPool.sol";
import "./InvariantGrowthProtocolFees.sol";

/**
 * @dev Basic Weighted Pool with immutable weights.
 */
contract WeightedPool is BaseWeightedPool, InvariantGrowthProtocolFees {
    using FixedPoint for uint256;

    uint256 private constant _MAX_TOKENS = 20;

    uint256 private immutable _totalTokens;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;
    IERC20 internal immutable _token2;
    IERC20 internal immutable _token3;
    IERC20 internal immutable _token4;
    IERC20 internal immutable _token5;
    IERC20 internal immutable _token6;
    IERC20 internal immutable _token7;
    IERC20 internal immutable _token8;
    IERC20 internal immutable _token9;
    IERC20 internal immutable _token10;
    IERC20 internal immutable _token11;
    IERC20 internal immutable _token12;
    IERC20 internal immutable _token13;
    IERC20 internal immutable _token14;
    IERC20 internal immutable _token15;
    IERC20 internal immutable _token16;
    IERC20 internal immutable _token17;
    IERC20 internal immutable _token18;
    IERC20 internal immutable _token19;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.

    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;
    uint256 internal immutable _scalingFactor2;
    uint256 internal immutable _scalingFactor3;
    uint256 internal immutable _scalingFactor4;
    uint256 internal immutable _scalingFactor5;
    uint256 internal immutable _scalingFactor6;
    uint256 internal immutable _scalingFactor7;
    uint256 internal immutable _scalingFactor8;
    uint256 internal immutable _scalingFactor9;
    uint256 internal immutable _scalingFactor10;
    uint256 internal immutable _scalingFactor11;
    uint256 internal immutable _scalingFactor12;
    uint256 internal immutable _scalingFactor13;
    uint256 internal immutable _scalingFactor14;
    uint256 internal immutable _scalingFactor15;
    uint256 internal immutable _scalingFactor16;
    uint256 internal immutable _scalingFactor17;
    uint256 internal immutable _scalingFactor18;
    uint256 internal immutable _scalingFactor19;

    uint256 internal immutable _normalizedWeight0;
    uint256 internal immutable _normalizedWeight1;
    uint256 internal immutable _normalizedWeight2;
    uint256 internal immutable _normalizedWeight3;
    uint256 internal immutable _normalizedWeight4;
    uint256 internal immutable _normalizedWeight5;
    uint256 internal immutable _normalizedWeight6;
    uint256 internal immutable _normalizedWeight7;
    uint256 internal immutable _normalizedWeight8;
    uint256 internal immutable _normalizedWeight9;
    uint256 internal immutable _normalizedWeight10;
    uint256 internal immutable _normalizedWeight11;
    uint256 internal immutable _normalizedWeight12;
    uint256 internal immutable _normalizedWeight13;
    uint256 internal immutable _normalizedWeight14;
    uint256 internal immutable _normalizedWeight15;
    uint256 internal immutable _normalizedWeight16;
    uint256 internal immutable _normalizedWeight17;
    uint256 internal immutable _normalizedWeight18;
    uint256 internal immutable _normalizedWeight19;

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
            owner,
            false
        )
    {
        uint256 numTokens = tokens.length;
        InputHelpers.ensureInputLengthMatch(numTokens, normalizedWeights.length);

        _totalTokens = numTokens;

        // Ensure each normalized weight is above the minimum
        uint256 normalizedSum = 0;
        for (uint8 i = 0; i < numTokens; i++) {
            uint256 normalizedWeight = normalizedWeights[i];

            _require(normalizedWeight >= WeightedMath._MIN_WEIGHT, Errors.MIN_WEIGHT);
            normalizedSum = normalizedSum.add(normalizedWeight);
        }
        // Ensure that the normalized weights sum to ONE
        _require(normalizedSum == FixedPoint.ONE, Errors.NORMALIZED_WEIGHT_INVARIANT);

        _normalizedWeight0 = normalizedWeights[0];
        _normalizedWeight1 = normalizedWeights[1];
        _normalizedWeight2 = numTokens > 2 ? normalizedWeights[2] : 0;
        _normalizedWeight3 = numTokens > 3 ? normalizedWeights[3] : 0;
        _normalizedWeight4 = numTokens > 4 ? normalizedWeights[4] : 0;
        _normalizedWeight5 = numTokens > 5 ? normalizedWeights[5] : 0;
        _normalizedWeight6 = numTokens > 6 ? normalizedWeights[6] : 0;
        _normalizedWeight7 = numTokens > 7 ? normalizedWeights[7] : 0;
        _normalizedWeight8 = numTokens > 8 ? normalizedWeights[8] : 0;
        _normalizedWeight9 = numTokens > 9 ? normalizedWeights[9] : 0;
        _normalizedWeight10 = numTokens > 10 ? normalizedWeights[10] : 0;
        _normalizedWeight11 = numTokens > 11 ? normalizedWeights[11] : 0;
        _normalizedWeight12 = numTokens > 12 ? normalizedWeights[12] : 0;
        _normalizedWeight13 = numTokens > 13 ? normalizedWeights[13] : 0;
        _normalizedWeight14 = numTokens > 14 ? normalizedWeights[14] : 0;
        _normalizedWeight15 = numTokens > 15 ? normalizedWeights[15] : 0;
        _normalizedWeight16 = numTokens > 16 ? normalizedWeights[16] : 0;
        _normalizedWeight17 = numTokens > 17 ? normalizedWeights[17] : 0;
        _normalizedWeight18 = numTokens > 18 ? normalizedWeights[18] : 0;
        _normalizedWeight19 = numTokens > 19 ? normalizedWeights[19] : 0;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _token0 = tokens[0];
        _token1 = tokens[1];
        _token2 = numTokens > 2 ? tokens[2] : IERC20(0);
        _token3 = numTokens > 3 ? tokens[3] : IERC20(0);
        _token4 = numTokens > 4 ? tokens[4] : IERC20(0);
        _token5 = numTokens > 5 ? tokens[5] : IERC20(0);
        _token6 = numTokens > 6 ? tokens[6] : IERC20(0);
        _token7 = numTokens > 7 ? tokens[7] : IERC20(0);
        _token8 = numTokens > 8 ? tokens[8] : IERC20(0);
        _token9 = numTokens > 9 ? tokens[9] : IERC20(0);
        _token10 = numTokens > 10 ? tokens[10] : IERC20(0);
        _token11 = numTokens > 11 ? tokens[11] : IERC20(0);
        _token12 = numTokens > 12 ? tokens[12] : IERC20(0);
        _token13 = numTokens > 13 ? tokens[13] : IERC20(0);
        _token14 = numTokens > 14 ? tokens[14] : IERC20(0);
        _token15 = numTokens > 15 ? tokens[15] : IERC20(0);
        _token16 = numTokens > 16 ? tokens[16] : IERC20(0);
        _token17 = numTokens > 17 ? tokens[17] : IERC20(0);
        _token18 = numTokens > 18 ? tokens[18] : IERC20(0);
        _token19 = numTokens > 19 ? tokens[19] : IERC20(0);

        _scalingFactor0 = _computeScalingFactor(tokens[0]);
        _scalingFactor1 = _computeScalingFactor(tokens[1]);
        _scalingFactor2 = numTokens > 2 ? _computeScalingFactor(tokens[2]) : 0;
        _scalingFactor3 = numTokens > 3 ? _computeScalingFactor(tokens[3]) : 0;
        _scalingFactor4 = numTokens > 4 ? _computeScalingFactor(tokens[4]) : 0;
        _scalingFactor5 = numTokens > 5 ? _computeScalingFactor(tokens[5]) : 0;
        _scalingFactor6 = numTokens > 6 ? _computeScalingFactor(tokens[6]) : 0;
        _scalingFactor7 = numTokens > 7 ? _computeScalingFactor(tokens[7]) : 0;
        _scalingFactor8 = numTokens > 8 ? _computeScalingFactor(tokens[8]) : 0;
        _scalingFactor9 = numTokens > 9 ? _computeScalingFactor(tokens[9]) : 0;
        _scalingFactor10 = numTokens > 10 ? _computeScalingFactor(tokens[10]) : 0;
        _scalingFactor11 = numTokens > 11 ? _computeScalingFactor(tokens[11]) : 0;
        _scalingFactor12 = numTokens > 12 ? _computeScalingFactor(tokens[12]) : 0;
        _scalingFactor13 = numTokens > 13 ? _computeScalingFactor(tokens[13]) : 0;
        _scalingFactor14 = numTokens > 14 ? _computeScalingFactor(tokens[14]) : 0;
        _scalingFactor15 = numTokens > 15 ? _computeScalingFactor(tokens[15]) : 0;
        _scalingFactor16 = numTokens > 16 ? _computeScalingFactor(tokens[16]) : 0;
        _scalingFactor17 = numTokens > 17 ? _computeScalingFactor(tokens[17]) : 0;
        _scalingFactor18 = numTokens > 18 ? _computeScalingFactor(tokens[18]) : 0;
        _scalingFactor19 = numTokens > 19 ? _computeScalingFactor(tokens[19]) : 0;
    }

    function _getNormalizedWeight(IERC20 token) internal view virtual override returns (uint256) {
        // prettier-ignore
        if (token == _token0) { return _normalizedWeight0; }
        else if (token == _token1) { return _normalizedWeight1; }
        else if (token == _token2) { return _normalizedWeight2; }
        else if (token == _token3) { return _normalizedWeight3; }
        else if (token == _token4) { return _normalizedWeight4; }
        else if (token == _token5) { return _normalizedWeight5; }
        else if (token == _token6) { return _normalizedWeight6; }
        else if (token == _token7) { return _normalizedWeight7; }
        else if (token == _token8) { return _normalizedWeight8; }
        else if (token == _token9) { return _normalizedWeight9; }
        else if (token == _token10) { return _normalizedWeight10; }
        else if (token == _token11) { return _normalizedWeight11; }
        else if (token == _token12) { return _normalizedWeight12; }
        else if (token == _token13) { return _normalizedWeight13; }
        else if (token == _token14) { return _normalizedWeight14; }
        else if (token == _token15) { return _normalizedWeight15; }
        else if (token == _token16) { return _normalizedWeight16; }
        else if (token == _token17) { return _normalizedWeight17; }
        else if (token == _token18) { return _normalizedWeight18; }
        else if (token == _token19) { return _normalizedWeight19; }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _getNormalizedWeights() internal view virtual override returns (uint256[] memory) {
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory normalizedWeights = new uint256[](totalTokens);

        // prettier-ignore
        {
            normalizedWeights[0] = _normalizedWeight0;
            normalizedWeights[1] = _normalizedWeight1;
            if (totalTokens > 2) { normalizedWeights[2] = _normalizedWeight2; } else { return normalizedWeights; }
            if (totalTokens > 3) { normalizedWeights[3] = _normalizedWeight3; } else { return normalizedWeights; }
            if (totalTokens > 4) { normalizedWeights[4] = _normalizedWeight4; } else { return normalizedWeights; }
            if (totalTokens > 5) { normalizedWeights[5] = _normalizedWeight5; } else { return normalizedWeights; }
            if (totalTokens > 6) { normalizedWeights[6] = _normalizedWeight6; } else { return normalizedWeights; }
            if (totalTokens > 7) { normalizedWeights[7] = _normalizedWeight7; } else { return normalizedWeights; }
            if (totalTokens > 8) { normalizedWeights[8] = _normalizedWeight8; } else { return normalizedWeights; }
            if (totalTokens > 9) { normalizedWeights[9] = _normalizedWeight9; } else { return normalizedWeights; }
            if (totalTokens > 10) { normalizedWeights[10] = _normalizedWeight10; } else { return normalizedWeights; }
            if (totalTokens > 11) { normalizedWeights[11] = _normalizedWeight11; } else { return normalizedWeights; }
            if (totalTokens > 12) { normalizedWeights[12] = _normalizedWeight12; } else { return normalizedWeights; }
            if (totalTokens > 13) { normalizedWeights[13] = _normalizedWeight13; } else { return normalizedWeights; }
            if (totalTokens > 14) { normalizedWeights[14] = _normalizedWeight14; } else { return normalizedWeights; }
            if (totalTokens > 15) { normalizedWeights[15] = _normalizedWeight15; } else { return normalizedWeights; }
            if (totalTokens > 16) { normalizedWeights[16] = _normalizedWeight16; } else { return normalizedWeights; }
            if (totalTokens > 17) { normalizedWeights[17] = _normalizedWeight17; } else { return normalizedWeights; }
            if (totalTokens > 18) { normalizedWeights[18] = _normalizedWeight18; } else { return normalizedWeights; }
            if (totalTokens > 19) { normalizedWeights[19] = _normalizedWeight19; } else { return normalizedWeights; }
        }

        return normalizedWeights;
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
        if (token == _token0) { return _scalingFactor0; }
        else if (token == _token1) { return _scalingFactor1; }
        else if (token == _token2) { return _scalingFactor2; }
        else if (token == _token3) { return _scalingFactor3; }
        else if (token == _token4) { return _scalingFactor4; }
        else if (token == _token5) { return _scalingFactor5; }
        else if (token == _token6) { return _scalingFactor6; }
        else if (token == _token7) { return _scalingFactor7; }
        else if (token == _token8) { return _scalingFactor8; }
        else if (token == _token9) { return _scalingFactor9; }
        else if (token == _token10) { return _scalingFactor10; }
        else if (token == _token11) { return _scalingFactor11; }
        else if (token == _token12) { return _scalingFactor12; }
        else if (token == _token13) { return _scalingFactor13; }
        else if (token == _token14) { return _scalingFactor14; }
        else if (token == _token15) { return _scalingFactor15; }
        else if (token == _token16) { return _scalingFactor16; }
        else if (token == _token17) { return _scalingFactor17; }
        else if (token == _token18) { return _scalingFactor18; }
        else if (token == _token19) { return _scalingFactor19; }
        else {
            _revert(Errors.INVALID_TOKEN);
        }
    }

    function _scalingFactors() internal view virtual override returns (uint256[] memory) {
        uint256 totalTokens = _getTotalTokens();
        uint256[] memory scalingFactors = new uint256[](totalTokens);

        // prettier-ignore
        {
            scalingFactors[0] = _scalingFactor0;
            scalingFactors[1] = _scalingFactor1;
            if (totalTokens > 2) { scalingFactors[2] = _scalingFactor2; } else { return scalingFactors; }
            if (totalTokens > 3) { scalingFactors[3] = _scalingFactor3; } else { return scalingFactors; }
            if (totalTokens > 4) { scalingFactors[4] = _scalingFactor4; } else { return scalingFactors; }
            if (totalTokens > 5) { scalingFactors[5] = _scalingFactor5; } else { return scalingFactors; }
            if (totalTokens > 6) { scalingFactors[6] = _scalingFactor6; } else { return scalingFactors; }
            if (totalTokens > 7) { scalingFactors[7] = _scalingFactor7; } else { return scalingFactors; }
            if (totalTokens > 8) { scalingFactors[8] = _scalingFactor8; } else { return scalingFactors; }
            if (totalTokens > 9) { scalingFactors[9] = _scalingFactor9; } else { return scalingFactors; }
            if (totalTokens > 10) { scalingFactors[10] = _scalingFactor10; } else { return scalingFactors; }
            if (totalTokens > 11) { scalingFactors[11] = _scalingFactor11; } else { return scalingFactors; }
            if (totalTokens > 12) { scalingFactors[12] = _scalingFactor12; } else { return scalingFactors; }
            if (totalTokens > 13) { scalingFactors[13] = _scalingFactor13; } else { return scalingFactors; }
            if (totalTokens > 14) { scalingFactors[14] = _scalingFactor14; } else { return scalingFactors; }
            if (totalTokens > 15) { scalingFactors[15] = _scalingFactor15; } else { return scalingFactors; }
            if (totalTokens > 16) { scalingFactors[16] = _scalingFactor16; } else { return scalingFactors; }
            if (totalTokens > 17) { scalingFactors[17] = _scalingFactor17; } else { return scalingFactors; }
            if (totalTokens > 18) { scalingFactors[18] = _scalingFactor18; } else { return scalingFactors; }
            if (totalTokens > 19) { scalingFactors[19] = _scalingFactor19; } else { return scalingFactors; }
        }

        return scalingFactors;
    }

    // InvariantGrowthProtocolFees

    function _beforeJoinExit(
        uint256[] memory preBalances,
        uint256[] memory normalizedWeights,
        uint256 protocolSwapFeePercentage
    ) internal virtual override(BaseWeightedPool, InvariantGrowthProtocolFees) {
        InvariantGrowthProtocolFees._beforeJoinExit(preBalances, normalizedWeights, protocolSwapFeePercentage);
    }

    function _afterJoinExit(
        bool isJoin,
        uint256[] memory preBalances,
        uint256[] memory balanceDeltas,
        uint256[] memory normalizedWeights
    ) internal virtual override(BaseWeightedPool, InvariantGrowthProtocolFees) {
        InvariantGrowthProtocolFees._afterJoinExit(isJoin, preBalances, balanceDeltas, normalizedWeights);
    }
}
