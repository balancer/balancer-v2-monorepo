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
import "../../vendor/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../BalancerPoolToken.sol";
import "../IBPTPool.sol";

import "../../vault/interfaces/IVault.sol";
import "../../vault/interfaces/IPoolQuote.sol";
import "../../math/FixedPoint.sol";
import "../../helpers/UnsafeRandom.sol";

import "./StablecoinMath.sol";

contract StablecoinPool is IPoolQuote, IBPTPool, StablecoinMath, BalancerPoolToken, ReentrancyGuard {
    using FixedPoint for uint256;

    IVault private immutable _vault;
    bytes32 private immutable _poolId;

    uint256 private immutable _amp;
    uint256 private immutable _swapFee;

    uint256 private _lastInvariant;

    uint256 private constant _MIN_SWAP_FEE = 0;
    uint256 private constant _MAX_SWAP_FEE = 10 * (10**16); // 10%

    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        uint256 initialBPT,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        address from,
        uint256 amp,
        uint256 swapFee
    ) BalancerPoolToken(name, symbol) {
        require(tokens.length >= 2, "ERR_MIN_TOKENS");

        bytes32 poolId = vault.registerPool(IVault.PoolOptimization.STANDARD);

        vault.registerTokens(poolId, tokens);
        vault.addLiquidity(poolId, from, tokens, amounts, false);

        require(vault.getPoolTokens(poolId).length == tokens.length, "ERR_REPEATED_TOKENS");

        _mintPoolTokens(from, initialBPT);

        // Set immutable state variables - these cannot be read from during construction
        _vault = vault;
        _poolId = poolId;

        require(swapFee >= _MIN_SWAP_FEE, "ERR__MIN_SWAP_FEE");
        require(swapFee <= _MAX_SWAP_FEE, "ERR_MAX_MAX_FEE");
        _swapFee = swapFee;

        _amp = amp;

        //Reset Invariant
        _resetAccumulatedSwapFees(amp, amounts);
    }

    //Getters

    function getVault() external view override returns (IVault) {
        return _vault;
    }

    function getPoolId() external view override returns (bytes32) {
        return _poolId;
    }

    function getAmplification() external view returns (uint256) {
        return _amp;
    }

    function getSwapFee() external view returns (uint256) {
        return _swapFee;
    }

    //Quote Swaps

    function quoteOutGivenIn(
        IPoolQuoteStructs.QuoteRequestGivenIn calldata request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint256) {
        uint256 adjustedIn = _subtractSwapFee(request.amountIn);
        uint256 maximumAmountOut = _outGivenIn(_amp, balances, indexIn, indexOut, adjustedIn);
        return maximumAmountOut;
    }

    function quoteInGivenOut(
        IPoolQuoteStructs.QuoteRequestGivenOut calldata request,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) external view override returns (uint256) {
        uint256 minimumAmountIn = _inGivenOut(_amp, balances, indexIn, indexOut, request.amountOut);
        return _addSwapFee(minimumAmountIn);
    }

    //Protocol Fees

    function _payProtocolFees(IERC20[] memory tokens, uint256[] memory balances) internal returns (uint256[] memory) {
        uint256[] memory swapFeesCollected = _getAccumulatedSwapFees(balances);
        return _vault.paySwapProtocolFees(_poolId, tokens, swapFeesCollected);
    }

    function _getAccumulatedSwapFees(uint256[] memory balances) internal view returns (uint256[] memory) {
        uint256[] memory swapFeesCollected = new uint256[](balances.length);

        uint256 index = UnsafeRandom.rand(balances.length);
        swapFeesCollected[index] = _calculateOneTokenSwapFee(_amp, balances, _lastInvariant, index);

        return swapFeesCollected;
    }

    function _resetAccumulatedSwapFees(uint256 amp, uint256[] memory balances) internal {
        _lastInvariant = _invariant(amp, balances);
    }

    // Pays protocol swap fees
    function payProtocolFees() external nonReentrant {
        (IERC20[] memory tokens, uint256[] memory balances) = _getPoolTokenBalances();
        balances = _payProtocolFees(tokens, balances);
        _resetAccumulatedSwapFees(_amp, balances);
    }

    //Join / Exit

    function joinPool(
        uint256 poolAmountOut,
        uint256[] calldata maxAmountsIn,
        bool transferTokens,
        address beneficiary
    ) external override nonReentrant {
        (IERC20[] memory tokens, uint256[] memory balances) = _getPoolTokenBalances();
        require(maxAmountsIn.length == tokens.length, "Tokens and amounts length mismatch");

        //Pay protocol fees to have balances up to date
        balances = _payProtocolFees(tokens, balances);

        uint256 ratio = _getSupplyRatio(poolAmountOut);
        uint256[] memory amountsIn = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 amount = balances[i].mul(ratio);
            require(amount <= maxAmountsIn[i], "ERR_LIMIT_IN");

            amountsIn[i] = amount;
            balances[i] = balances[i].add(amount);
        }

        _vault.addLiquidity(_poolId, msg.sender, tokens, amountsIn, !transferTokens);

        //Reset swap fees counter
        _resetAccumulatedSwapFees(_amp, balances);

        _mintPoolTokens(beneficiary, poolAmountOut);
    }

    function exitPool(
        uint256 poolAmountIn,
        uint256[] calldata minAmountsOut,
        bool withdrawTokens,
        address beneficiary
    ) external override nonReentrant {
        (IERC20[] memory tokens, uint256[] memory balances) = _getPoolTokenBalances();
        require(minAmountsOut.length == tokens.length, "Tokens and amounts length mismatch");

        //Pay protocol fees to have balances up to date
        balances = _payProtocolFees(tokens, balances);

        uint256 ratio = _getSupplyRatio(poolAmountIn);
        uint256[] memory amountsOut = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 amount = balances[i].mul(ratio);
            require(amount >= minAmountsOut[i], "NOT EXITING ENOUGH");

            amountsOut[i] = amount;
            balances[i] = balances[i].sub(amount);
        }

        _vault.removeLiquidity(_poolId, beneficiary, tokens, amountsOut, !withdrawTokens);

        //Reset swap fees counter
        _resetAccumulatedSwapFees(_amp, balances);

        _burnPoolTokens(msg.sender, poolAmountIn);
    }

    function _getSupplyRatio(uint256 amount) internal view returns (uint256) {
        uint256 poolTotal = totalSupply();
        uint256 ratio = amount.div(poolTotal);
        require(ratio != 0, "ERR_MATH_APPROX");
        return ratio;
    }

    // potential helpers

    function _addSwapFee(uint256 amount) internal view returns (uint256) {
        return amount.div(uint256(FixedPoint.ONE).sub(_swapFee));
    }

    function _subtractSwapFee(uint256 amount) internal view returns (uint256) {
        uint256 fees = amount.mul(_swapFee);
        return amount.sub(fees);
    }

    function _getPoolTokenBalances() internal view returns (IERC20[] memory tokens, uint256[] memory balances) {
        tokens = _vault.getPoolTokens(_poolId);
        // We trust the number of tokens returned from the Vault since these are registered in the constructor

        balances = _vault.getPoolTokenBalances(_poolId, tokens);
        bool someLiquidity = true;
        for (uint256 i = 0; i < tokens.length && someLiquidity; i++) {
            someLiquidity = balances[i] != 0;
        }

        require(someLiquidity, "ERR_ZERO_LIQUIDITY");
    }
}
