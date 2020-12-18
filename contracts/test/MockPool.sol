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

import "../vault/IVault.sol";
import "../vault/interfaces/IPairTradingStrategy.sol";
import "../vault/interfaces/ITupleTradingStrategy.sol";

import "../math/FixedPoint.sol";

contract MockPool is IPairTradingStrategy, ITupleTradingStrategy {
    using FixedPoint for uint256;
    using FixedPoint for uint128;

    IVault private immutable _vault;
    bytes32 public immutable poolId;

    constructor(IVault vault, IVault.StrategyType strategyType) {
        poolId = vault.newPool(address(this), strategyType);
        _vault = vault;
    }

    function addLiquidity(IERC20[] memory tokens, uint128[] memory amounts) external {
        _vault.addLiquidity(poolId, msg.sender, tokens, amounts, false);
    }

    function removeLiquidity(IERC20[] memory tokens, uint128[] memory amounts) external {
        _vault.removeLiquidity(poolId, msg.sender, tokens, amounts, false);
    }

    function paySwapProtocolFees(IERC20[] memory tokens, uint128[] memory collectedFees) external {
        _vault.paySwapProtocolFees(poolId, tokens, collectedFees);
    }

    // Amounts in are multiplied by the multiplier, amounts out divided by it
    uint128 private _multiplier = FixedPoint.ONE;

    function setMultiplier(uint128 newMultiplier) external {
        _multiplier = newMultiplier;
    }

    // IPairTradingStrategy
    function quoteOutGivenIn(
        ITradingStrategy.QuoteRequestGivenIn calldata request,
        uint128,
        uint128
    ) external view override returns (uint128) {
        return request.amountIn.mul128(_multiplier);
    }

    function quoteInGivenOut(
        ITradingStrategy.QuoteRequestGivenOut calldata request,
        uint128,
        uint128
    ) external view override returns (uint128) {
        uint128 amountIn = request.amountOut.div128(_multiplier);
        return amountIn;
    }

    // ITupleTradingStrategy
    function quoteOutGivenIn(
        ITradingStrategy.QuoteRequestGivenIn calldata request,
        uint128[] calldata,
        uint256,
        uint256
    ) external view override returns (uint128) {
        return request.amountIn.mul128(_multiplier);
    }

    function quoteInGivenOut(
        ITradingStrategy.QuoteRequestGivenOut calldata request,
        uint128[] calldata,
        uint256,
        uint256
    ) external view override returns (uint128) {
        uint128 amountIn = request.amountOut.div128(_multiplier);
        return amountIn;
    }
}
