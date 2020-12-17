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

import "hardhat/console.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../../math/FixedPoint.sol";

import "../../vault/IVault.sol";
import "../../vault/interfaces/IPairTradingStrategy.sol";

import "../BToken.sol";
import "../IBPTPool.sol";
import "./ConstantProductMath.sol";

// This contract relies on tons of immutable state variables to
// perform efficient lookup, without resorting to storage reads.

contract ConstantProductPool is IBPTPool, IPairTradingStrategy, BToken, ConstantProductMath, ReentrancyGuard {
    using FixedPoint for uint128;
    using FixedPoint for uint256;
    using SafeCast for uint256;

    IVault private immutable _vault;
    bytes32 private immutable _poolId;

    uint8 internal constant MIN_TOKENS = 2;
    uint8 internal constant MAX_TOKENS = 16;

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

    uint256 internal immutable _totalTokens;

    uint128 private immutable _weight0;
    uint128 private immutable _weight1;
    uint128 private immutable _weight2;
    uint128 private immutable _weight3;
    uint128 private immutable _weight4;
    uint128 private immutable _weight5;
    uint128 private immutable _weight6;
    uint128 private immutable _weight7;
    uint128 private immutable _weight8;
    uint128 private immutable _weight9;
    uint128 private immutable _weight10;
    uint128 private immutable _weight11;
    uint128 private immutable _weight12;
    uint128 private immutable _weight13;
    uint128 private immutable _weight14;
    uint128 private immutable _weight15;

    uint128 private immutable _swapFee;

    uint128 private constant MIN_FEE = 0;
    uint128 private constant MAX_FEE = 10 * (10**16); // 10%

    constructor(
        IVault vault,
        uint256 initialBPT,
        IERC20[] memory tokens,
        uint128[] memory amounts,
        address from,
        uint128[] memory weights,
        uint128 swapFee
    ) {
        require(tokens.length >= MIN_TOKENS, "ERR_MIN_TOKENS");
        require(tokens.length <= MAX_TOKENS, "ERR_MAX_TOKENS");

        require(tokens.length == amounts.length, "ERR_TOKENS_AMOUNTS_LENGTH");
        require(tokens.length == weights.length, "ERR_TOKENS_WEIGHTS_LENGTH");

        IVault.StrategyType strategyType = IVault.StrategyType.PAIR; // TODO: make it TWO_TOKEN if tokens.lenght == 2

        bytes32 poolId = vault.newPool(address(this), strategyType);
        vault.addLiquidity(poolId, from, tokens, amounts, false);

        require(vault.getPoolTokens(poolId).length == tokens.length, "ERR_REPEATED_TOKENS");

        _mintPoolShare(initialBPT);
        _pushPoolShare(from, initialBPT);

        // Set immutable state variables - these cannot be read from during construction
        _vault = vault;
        _poolId = poolId;

        _totalTokens = tokens.length;

        // Immutable variables cannot be initialized inside an if statement, so we must do conditional assignments
        _token0 = tokens.length > 0 ? tokens[0] : IERC20(0);
        _token1 = tokens.length > 1 ? tokens[1] : IERC20(0);
        _token2 = tokens.length > 2 ? tokens[2] : IERC20(0);
        _token3 = tokens.length > 3 ? tokens[3] : IERC20(0);
        _token4 = tokens.length > 4 ? tokens[4] : IERC20(0);
        _token5 = tokens.length > 5 ? tokens[5] : IERC20(0);
        _token6 = tokens.length > 6 ? tokens[6] : IERC20(0);
        _token7 = tokens.length > 7 ? tokens[7] : IERC20(0);
        _token8 = tokens.length > 8 ? tokens[8] : IERC20(0);
        _token9 = tokens.length > 9 ? tokens[9] : IERC20(0);
        _token10 = tokens.length > 10 ? tokens[10] : IERC20(0);
        _token11 = tokens.length > 11 ? tokens[11] : IERC20(0);
        _token12 = tokens.length > 12 ? tokens[12] : IERC20(0);
        _token13 = tokens.length > 13 ? tokens[13] : IERC20(0);
        _token14 = tokens.length > 14 ? tokens[14] : IERC20(0);
        _token15 = tokens.length > 15 ? tokens[15] : IERC20(0);

        _weight0 = weights.length > 0 ? weights[0] : 0;
        _weight1 = weights.length > 1 ? weights[1] : 0;
        _weight2 = weights.length > 2 ? weights[2] : 0;
        _weight3 = weights.length > 3 ? weights[3] : 0;
        _weight4 = weights.length > 4 ? weights[4] : 0;
        _weight5 = weights.length > 5 ? weights[5] : 0;
        _weight6 = weights.length > 6 ? weights[6] : 0;
        _weight7 = weights.length > 7 ? weights[7] : 0;
        _weight8 = weights.length > 8 ? weights[8] : 0;
        _weight9 = weights.length > 9 ? weights[9] : 0;
        _weight10 = weights.length > 10 ? weights[10] : 0;
        _weight11 = weights.length > 11 ? weights[11] : 0;
        _weight12 = weights.length > 12 ? weights[12] : 0;
        _weight13 = weights.length > 13 ? weights[13] : 0;
        _weight14 = weights.length > 14 ? weights[14] : 0;
        _weight15 = weights.length > 15 ? weights[15] : 0;

        require(swapFee >= MIN_FEE, "ERR_MIN_FEE");
        require(swapFee <= MAX_FEE, "ERR_MAX_FEE");
        _swapFee = swapFee;
    }

    function _weight(IERC20 token) internal view returns (uint128) {
        if (token == _token0) {
            return _weight0;
        } else if (token == _token1) {
            return _weight1;
        } else if (token == _token2) {
            return _weight2;
        } else if (token == _token3) {
            return _weight3;
        } else if (token == _token4) {
            return _weight4;
        } else if (token == _token5) {
            return _weight5;
        } else if (token == _token6) {
            return _weight6;
        } else if (token == _token7) {
            return _weight7;
        } else if (token == _token8) {
            return _weight8;
        } else if (token == _token9) {
            return _weight9;
        } else if (token == _token10) {
            return _weight10;
        } else if (token == _token11) {
            return _weight11;
        } else if (token == _token12) {
            return _weight12;
        } else if (token == _token13) {
            return _weight13;
        } else if (token == _token14) {
            return _weight14;
        } else if (token == _token15) {
            return _weight15;
        } else {
            revert("ERR_INVALID_TOKEN");
        }
    }

    function getVault() external view override returns (IVault) {
        return _vault;
    }

    function getPoolId() external view override returns (bytes32) {
        return _poolId;
    }

    function getWeights(IERC20[] memory tokens) public view returns (uint128[] memory) {
        uint128[] memory weights = new uint128[](tokens.length);

        for (uint256 i = 0; i < weights.length; ++i) {
            weights[i] = _weight(tokens[i]);
        }

        return weights;
    }

    function getSwapFee() public view returns (uint128) {
        return _swapFee;
    }

    function quoteOutGivenIn(
        QuoteRequestGivenIn calldata request,
        uint128 currentBalanceTokenIn,
        uint128 currentBalanceTokenOut
    ) external view override returns (uint128) {
        uint128 adjustedIn = _subtractSwapFee(request.amountIn);

        // Calculate the maximum amount that can be taken out of the pool
        uint128 maximumAmountOut = _outGivenIn(
            currentBalanceTokenIn,
            _weight(request.tokenIn),
            currentBalanceTokenOut,
            _weight(request.tokenOut),
            adjustedIn
        );

        return maximumAmountOut;
    }

    function quoteInGivenOut(
        QuoteRequestGivenOut calldata request,
        uint128 currentBalanceTokenIn,
        uint128 currentBalanceTokenOut
    ) external view override returns (uint128) {
        // Calculate the minimum amount that must be put into the pool
        uint128 minimumAmountIn = _inGivenOut(
            currentBalanceTokenIn,
            _weight(request.tokenIn),
            currentBalanceTokenOut,
            _weight(request.tokenOut),
            request.amountOut
        );

        return _addSwapFee(minimumAmountIn);
    }

    function joinPool(
        uint256 poolAmountOut,
        uint128[] calldata maxAmountsIn,
        bool transferTokens,
        address beneficiary
    ) external override nonReentrant {
        IERC20[] memory tokens = _vault.getPoolTokens(_poolId);
        uint128[] memory balances = _vault.getPoolTokenBalances(_poolId, tokens);

        uint256 poolTotal = totalSupply();
        uint128 ratio = poolAmountOut.div(poolTotal).toUint128();
        require(ratio != 0, "ERR_MATH_APPROX");

        require(maxAmountsIn.length == tokens.length, "Tokens and amounts length mismatch");

        uint128[] memory amountsIn = new uint128[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amountsIn[i] = balances[i].mul128(ratio);
            require(amountsIn[i] <= maxAmountsIn[i], "ERR_LIMIT_IN");
        }

        _vault.addLiquidity(_poolId, msg.sender, tokens, amountsIn, !transferTokens);

        _mintPoolShare(poolAmountOut);
        _pushPoolShare(beneficiary, poolAmountOut);
    }

    function exitPool(
        uint256 poolAmountIn,
        uint256[] calldata minAmountsOut,
        bool withdrawTokens,
        address beneficiary
    ) external override nonReentrant {
        IERC20[] memory tokens = _vault.getPoolTokens(_poolId);
        uint128[] memory balances = _vault.getPoolTokenBalances(_poolId, tokens);

        uint256 poolTotal = totalSupply();
        uint128 ratio = poolAmountIn.div(poolTotal).toUint128();
        require(ratio != 0, "ERR_MATH_APPROX");

        require(minAmountsOut.length == tokens.length, "Tokens and amounts length mismatch");

        uint128[] memory amountsOut = new uint128[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amountsOut[i] = balances[i].mul128(ratio);
            require(amountsOut[i] >= minAmountsOut[i], "NOT EXITING ENOUGH");
        }

        _vault.removeLiquidity(_poolId, beneficiary, tokens, amountsOut, !withdrawTokens);

        _pullPoolShare(msg.sender, poolAmountIn);
        _burnPoolShare(poolAmountIn);
    }

    // Potential helpers

    function _addSwapFee(uint128 amount) internal view returns (uint128) {
        return amount.div128(FixedPoint.ONE.sub128(_swapFee));
    }

    function _subtractSwapFee(uint128 amount) internal view returns (uint128) {
        uint128 fees = amount.mul128(_swapFee);
        return amount.sub128(fees);
    }

    // To be moved to Balancer Pool Token

    function _pullPoolShare(address from, uint256 amount) internal {
        _pull(from, amount);
    }

    function _pushPoolShare(address to, uint256 amount) internal {
        _push(to, amount);
    }

    function _mintPoolShare(uint256 amount) internal {
        _mint(amount);
    }

    function _burnPoolShare(uint256 amount) internal {
        _burn(amount);
    }
}
