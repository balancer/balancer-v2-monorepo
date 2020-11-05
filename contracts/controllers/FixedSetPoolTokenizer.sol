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

import "@openzeppelin/contracts/utils/SafeCast.sol";

import "../vault/IVault.sol";
import "../math/FixedPoint.sol";

import "./BToken.sol";

contract FixedSetPoolTokenizer is BToken {
    using FixedPoint for uint128;
    using SafeCast for uint256;

    IVault public immutable vault;
    bytes32 public immutable poolId;
    bool private _mutex;

    modifier _lock_() {
        require(!_mutex, "ERR_REENTRY");
        _mutex = true;
        _;
        _mutex = false;
    }

    constructor(
        IVault _vault,
        address strategy,
        IVault.StrategyType strategyType
    ) {
        vault = _vault;
        poolId = _vault.newPool(strategy, strategyType);
    }

    // Placeholder - this will be part of the constructor once we address
    // https://github.com/balancer-labs/balancer-core-v2/issues/76
    function initialize(
        uint256 initialBPT,
        address[] memory tokens,
        uint128[] memory amounts
    ) public {
        // Transfer all tokens, don't use user balance
        uint128[] memory amountsToTransfer = new uint128[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            amountsToTransfer[i] = amounts[i];
        }

        vault.addLiquidity(
            poolId,
            msg.sender,
            tokens,
            amounts,
            amountsToTransfer
        );

        _mintPoolShare(initialBPT);
        _pushPoolShare(msg.sender, initialBPT);
    }

    // Joining a pool
    // poolAmountOut - how much bpt the user expects to get
    // maxAmountsIn - the max amounts of each token the user is willing to add to the vault
    // The set of tokens is not specified because it is read from the Vault - and remains immutable that way.
    function joinPool(
        uint256 poolAmountOut,
        uint128[] calldata maxAmountsIn,
        bool transferTokens
    ) external _lock_ {
        uint256 poolTotal = totalSupply();
        uint128 ratio = bdiv(poolAmountOut, poolTotal).toUint128();
        require(ratio != 0, "ERR_MATH_APPROX");

        address[] memory tokens = vault.getPoolTokens(poolId);
        uint128[] memory balances = vault.getPoolTokenBalances(poolId, tokens);

        require(
            maxAmountsIn.length == tokens.length,
            "Tokens and amounts length mismatch"
        );

        uint128[] memory amountsIn = new uint128[](tokens.length);
        uint128[] memory amountsToTransfer = new uint128[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            amountsIn[i] = balances[i].mul128(ratio);
            require(amountsIn[i] <= maxAmountsIn[i], "ERR_LIMIT_IN");

            if (transferTokens) {
                amountsToTransfer[i] = amountsIn[i];
            } else {
                // This leads into user balance withdrawals
                amountsToTransfer[i] = 0;
            }
        }

        vault.addLiquidity(
            poolId,
            msg.sender,
            tokens,
            amountsIn,
            amountsToTransfer
        );

        _mintPoolShare(poolAmountOut);
        _pushPoolShare(msg.sender, poolAmountOut);
    }

    function exitPool(
        uint256 poolAmountIn,
        uint256[] calldata minAmountsOut,
        bool withdrawTokens
    ) external _lock_ {
        uint256 poolTotal = totalSupply();
        uint128 ratio = bdiv(poolAmountIn, poolTotal).toUint128();
        require(ratio != 0, "ERR_MATH_APPROX");

        address[] memory tokens = vault.getPoolTokens(poolId);
        uint128[] memory balances = vault.getPoolTokenBalances(poolId, tokens);

        require(
            minAmountsOut.length == tokens.length,
            "Tokens and amounts length mismatch"
        );

        uint128[] memory amountsOut = new uint128[](tokens.length);
        uint128[] memory amountsToTransfer = new uint128[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            amountsOut[i] = balances[i].mul128(ratio);
            require(amountsOut[i] >= minAmountsOut[i], "NOT EXITING ENOUGH");

            if (withdrawTokens) {
                amountsToTransfer[i] = amountsOut[i];
            } else {
                // This leads into user balance deposits
                amountsToTransfer[i] = 0;
            }
        }

        vault.removeLiquidity(
            poolId,
            msg.sender,
            tokens,
            amountsOut,
            amountsToTransfer
        );

        _pullPoolShare(msg.sender, poolAmountIn);
        _burnPoolShare(poolAmountIn);
    }

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
