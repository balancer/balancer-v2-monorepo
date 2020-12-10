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

pragma solidity ^0.7.1;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// solhint-disable max-states-count
contract WeightsStrategySetting {
    uint8 public constant MIN_TOKENS = 2;
    uint8 public constant MAX_TOKENS = 16;

    // TODO: MIN_WEIGHT and MAX_WEIGHT should depend on lib max and min weight ratio
    // Max weight ratio = 130
    // Min weight ratio = 0.008
    uint8 public constant MIN_WEIGHT = 1;

    bool private immutable _areWeightsMutable;
    uint256 private immutable _totalTokens;

    IERC20 private immutable _token0;
    IERC20 private immutable _token1;
    IERC20 private immutable _token2;
    IERC20 private immutable _token3;
    IERC20 private immutable _token4;
    IERC20 private immutable _token5;
    IERC20 private immutable _token6;
    IERC20 private immutable _token7;
    IERC20 private immutable _token8;
    IERC20 private immutable _token9;
    IERC20 private immutable _token10;
    IERC20 private immutable _token11;
    IERC20 private immutable _token12;
    IERC20 private immutable _token13;
    IERC20 private immutable _token14;
    IERC20 private immutable _token15;

    uint256 private immutable _immutableWeight0;
    uint256 private immutable _immutableWeight1;
    uint256 private immutable _immutableWeight2;
    uint256 private immutable _immutableWeight3;
    uint256 private immutable _immutableWeight4;
    uint256 private immutable _immutableWeight5;
    uint256 private immutable _immutableWeight6;
    uint256 private immutable _immutableWeight7;
    uint256 private immutable _immutableWeight8;
    uint256 private immutable _immutableWeight9;
    uint256 private immutable _immutableWeight10;
    uint256 private immutable _immutableWeight11;
    uint256 private immutable _immutableWeight12;
    uint256 private immutable _immutableWeight13;
    uint256 private immutable _immutableWeight14;
    uint256 private immutable _immutableWeight15;

    uint256 private _mutableWeight0;
    uint256 private _mutableWeight1;
    uint256 private _mutableWeight2;
    uint256 private _mutableWeight3;
    uint256 private _mutableWeight4;
    uint256 private _mutableWeight5;
    uint256 private _mutableWeight6;
    uint256 private _mutableWeight7;
    uint256 private _mutableWeight8;
    uint256 private _mutableWeight9;
    uint256 private _mutableWeight10;
    uint256 private _mutableWeight11;
    uint256 private _mutableWeight12;
    uint256 private _mutableWeight13;
    uint256 private _mutableWeight14;
    uint256 private _mutableWeight15;

    struct TokenWeights {
        bool isMutable;
        IERC20[] tokens;
        uint256[] weights;
    }

    event WeightsSet();

    constructor(TokenWeights memory setting) {
        uint256 totalTokens = setting.tokens.length;
        _validateWeights(setting.weights, totalTokens);

        require(totalTokens >= MIN_TOKENS, "ERR_MIN_TOKENS");
        require(totalTokens <= MAX_TOKENS, "ERR_MAX_TOKENS");
        for (uint8 i = 0; i < totalTokens; i++) {
            require(setting.tokens[i] != IERC20(0), "ERR_INVALID_ADDRESS");
        }

        // This is because immutable variables cannot be initialized inside an if statement or on another function.
        _token0 = totalTokens > 0 ? setting.tokens[0] : IERC20(0);
        _token1 = totalTokens > 1 ? setting.tokens[1] : IERC20(0);
        _token2 = totalTokens > 2 ? setting.tokens[2] : IERC20(0);
        _token3 = totalTokens > 3 ? setting.tokens[3] : IERC20(0);
        _token4 = totalTokens > 4 ? setting.tokens[4] : IERC20(0);
        _token5 = totalTokens > 5 ? setting.tokens[5] : IERC20(0);
        _token6 = totalTokens > 6 ? setting.tokens[6] : IERC20(0);
        _token7 = totalTokens > 7 ? setting.tokens[7] : IERC20(0);
        _token8 = totalTokens > 8 ? setting.tokens[8] : IERC20(0);
        _token9 = totalTokens > 9 ? setting.tokens[9] : IERC20(0);
        _token10 = totalTokens > 10 ? setting.tokens[10] : IERC20(0);
        _token11 = totalTokens > 11 ? setting.tokens[11] : IERC20(0);
        _token12 = totalTokens > 12 ? setting.tokens[12] : IERC20(0);
        _token13 = totalTokens > 13 ? setting.tokens[13] : IERC20(0);
        _token14 = totalTokens > 14 ? setting.tokens[14] : IERC20(0);
        _token15 = totalTokens > 15 ? setting.tokens[15] : IERC20(0);

        _immutableWeight0 = (!setting.isMutable && totalTokens > 0) ? setting.weights[0] : 0;
        _immutableWeight1 = (!setting.isMutable && totalTokens > 1) ? setting.weights[1] : 0;
        _immutableWeight2 = (!setting.isMutable && totalTokens > 2) ? setting.weights[2] : 0;
        _immutableWeight3 = (!setting.isMutable && totalTokens > 3) ? setting.weights[3] : 0;
        _immutableWeight4 = (!setting.isMutable && totalTokens > 4) ? setting.weights[4] : 0;
        _immutableWeight5 = (!setting.isMutable && totalTokens > 5) ? setting.weights[5] : 0;
        _immutableWeight6 = (!setting.isMutable && totalTokens > 6) ? setting.weights[6] : 0;
        _immutableWeight7 = (!setting.isMutable && totalTokens > 7) ? setting.weights[7] : 0;
        _immutableWeight8 = (!setting.isMutable && totalTokens > 8) ? setting.weights[8] : 0;
        _immutableWeight9 = (!setting.isMutable && totalTokens > 9) ? setting.weights[9] : 0;
        _immutableWeight10 = (!setting.isMutable && totalTokens > 10) ? setting.weights[10] : 0;
        _immutableWeight11 = (!setting.isMutable && totalTokens > 11) ? setting.weights[11] : 0;
        _immutableWeight12 = (!setting.isMutable && totalTokens > 12) ? setting.weights[12] : 0;
        _immutableWeight13 = (!setting.isMutable && totalTokens > 13) ? setting.weights[13] : 0;
        _immutableWeight14 = (!setting.isMutable && totalTokens > 14) ? setting.weights[14] : 0;
        _immutableWeight15 = (!setting.isMutable && totalTokens > 15) ? setting.weights[15] : 0;

        _totalTokens = totalTokens;
        _areWeightsMutable = setting.isMutable;

        if (setting.isMutable) {
            _unsafeSetWeights(setting.weights);
        }
        emit WeightsSet();
    }

    /**
     * @dev Returns the weight associated to a token
     * @param token Address of the token querying the weight of
     */
    function getWeight(IERC20 token) external view returns (uint256) {
        return _weight(token);
    }

    /**
     * @dev Tells the number of tokens configured in the strategy
     */
    function getTotalTokens() external view returns (uint256) {
        return _totalTokens;
    }

    /**
     * @dev Internal function to set a new list of token weights
     * @param weights New list of token weights
     */
    function _setWeights(uint256[] memory weights) internal {
        require(_areWeightsMutable, "TOKEN_WEIGHTS_NOT_MUTABLE");
        _validateWeights(weights, _totalTokens);
        _unsafeSetWeights(weights);
        emit WeightsSet();
    }

    /**
     * @dev Internal function to tell the weight associated to a token
     * @param token Address of the token querying the weight of
     */
    function _weight(IERC20 token) internal view returns (uint256) {
        if (token == _token0) {
            return _areWeightsMutable ? _mutableWeight0 : _immutableWeight0;
        } else if (token == _token1) {
            return _areWeightsMutable ? _mutableWeight1 : _immutableWeight1;
        } else if (token == _token2) {
            return _areWeightsMutable ? _mutableWeight2 : _immutableWeight2;
        } else if (token == _token3) {
            return _areWeightsMutable ? _mutableWeight3 : _immutableWeight3;
        } else if (token == _token4) {
            return _areWeightsMutable ? _mutableWeight4 : _immutableWeight4;
        } else if (token == _token5) {
            return _areWeightsMutable ? _mutableWeight5 : _immutableWeight5;
        } else if (token == _token6) {
            return _areWeightsMutable ? _mutableWeight6 : _immutableWeight6;
        } else if (token == _token7) {
            return _areWeightsMutable ? _mutableWeight7 : _immutableWeight7;
        } else if (token == _token8) {
            return _areWeightsMutable ? _mutableWeight8 : _immutableWeight8;
        } else if (token == _token9) {
            return _areWeightsMutable ? _mutableWeight9 : _immutableWeight9;
        } else if (token == _token10) {
            return _areWeightsMutable ? _mutableWeight10 : _immutableWeight10;
        } else if (token == _token11) {
            return _areWeightsMutable ? _mutableWeight11 : _immutableWeight11;
        } else if (token == _token12) {
            return _areWeightsMutable ? _mutableWeight12 : _immutableWeight12;
        } else if (token == _token13) {
            return _areWeightsMutable ? _mutableWeight13 : _immutableWeight13;
        } else if (token == _token14) {
            return _areWeightsMutable ? _mutableWeight14 : _immutableWeight14;
        } else if (token == _token15) {
            return _areWeightsMutable ? _mutableWeight15 : _immutableWeight15;
        } else {
            revert("ERR_INVALID_TOKEN");
        }
    }

    /**
     * @dev Private function to set a new list of token weights. This function does not perform any checks.
     * @param weights New list of token weights
     */
    function _unsafeSetWeights(uint256[] memory weights) private {
        uint256 totalWeights = weights.length;
        _mutableWeight0 = totalWeights > 0 ? weights[0] : 0;
        _mutableWeight1 = totalWeights > 1 ? weights[1] : 0;
        _mutableWeight2 = totalWeights > 2 ? weights[2] : 0;
        _mutableWeight3 = totalWeights > 3 ? weights[3] : 0;
        _mutableWeight4 = totalWeights > 4 ? weights[4] : 0;
        _mutableWeight5 = totalWeights > 5 ? weights[5] : 0;
        _mutableWeight6 = totalWeights > 6 ? weights[6] : 0;
        _mutableWeight7 = totalWeights > 7 ? weights[7] : 0;
        _mutableWeight8 = totalWeights > 8 ? weights[8] : 0;
        _mutableWeight9 = totalWeights > 9 ? weights[9] : 0;
        _mutableWeight10 = totalWeights > 10 ? weights[10] : 0;
        _mutableWeight11 = totalWeights > 11 ? weights[11] : 0;
        _mutableWeight12 = totalWeights > 12 ? weights[12] : 0;
        _mutableWeight13 = totalWeights > 13 ? weights[13] : 0;
        _mutableWeight14 = totalWeights > 14 ? weights[14] : 0;
        _mutableWeight15 = totalWeights > 15 ? weights[15] : 0;
    }

    function _validateWeights(uint256[] memory weights, uint256 expectedLength) private pure {
        require(weights.length == expectedLength, "ERR_WEIGHTS_LIST");

        for (uint8 i = 0; i < weights.length; i++) {
            require(weights[i] >= MIN_WEIGHT, "ERR_MIN_WEIGHT");
        }
    }
}
