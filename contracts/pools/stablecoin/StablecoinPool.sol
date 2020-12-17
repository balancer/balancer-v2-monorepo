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

import "../BToken.sol";
import "../IBPTPool.sol";

import "../../vault/IVault.sol";
import "../../vault/interfaces/ITupleTradingStrategy.sol";
import "../../math/FixedPoint.sol";

import "./StablecoinMath.sol";

contract StablecoinPool is ITupleTradingStrategy, IBPTPool, StablecoinMath, BToken, ReentrancyGuard {
    using FixedPoint for uint128;
    using FixedPoint for uint256;
    using SafeCast for uint256;

    IVault private immutable _vault;
    bytes32 private immutable _poolId;

    uint128 private immutable _amp;
    uint128 private immutable _swapFee;

    uint128 public constant MIN_SWAP_FEE = 0;
    uint128 public constant MAX_SWAP_FEE = 10**17; // 0.1%

    constructor(
        IVault vault,
        uint256 initialBPT,
        IERC20[] memory tokens,
        uint128[] memory amounts,
        address from,
        uint128 amp,
        uint128 swapFee
    ) {
        bytes32 poolId = vault.newPool(address(this), IVault.StrategyType.TUPLE);

        vault.addLiquidity(poolId, from, tokens, amounts, false);

        _mintPoolShare(initialBPT);
        _pushPoolShare(from, initialBPT);

        // Set immutable state variables - these cannot be read from during construction
        _vault = vault;
        _poolId = poolId;

        require(swapFee >= MIN_SWAP_FEE, "ERR_MIN_SWAP_FEE");
        require(swapFee <= MAX_SWAP_FEE, "ERR_MAX_FEE");
        _swapFee = swapFee;

        _amp = amp;
    }

    function getVault() external view override returns (IVault) {
        return _vault;
    }

    function getPoolId() external view override returns (bytes32) {
        return _poolId;
    }

    function getAmplification() public view returns (uint128) {
        return _amp;
    }

    function getSwapFee() public view returns (uint128) {
        return _swapFee;
    }

    function quoteOutGivenIn(
        QuoteRequestGivenIn calldata request,
        uint128[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint128) {
        uint128 adjustedIn = _subtractSwapFee(request.amountIn);
        uint128 maximumAmountOut = _outGivenIn(_amp, balances, indexIn, indexOut, adjustedIn);
        return maximumAmountOut;
    }

    function quoteInGivenOut(
        QuoteRequestGivenOut calldata request,
        uint128[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint128) {
        uint128 minimumAmountIn = _inGivenOut(_amp, balances, indexIn, indexOut, request.amountOut);
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

    // Move to BalancerPoolToken (BToken)

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

    // potential helpers
    function _addSwapFee(uint128 amount) internal view returns (uint128) {
        return amount.div128(FixedPoint.ONE.sub128(_swapFee));
    }

    function _subtractSwapFee(uint128 amount) internal view returns (uint128) {
        uint128 fees = amount.mul128(_swapFee);
        return amount.sub128(fees);
    }
}
