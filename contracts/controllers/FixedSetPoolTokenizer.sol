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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../strategies/StrategyInvariant.sol";

import "../vault/IVault.sol";
import "../math/FixedPoint.sol";

import "./BToken.sol";

contract FixedSetPoolTokenizer is BToken, ReentrancyGuard {
    using FixedPoint for uint128;
    using FixedPoint for uint256;
    using SafeCast for uint256;

    IVault public immutable vault;
    bytes32 public immutable poolId;
    address public immutable strategy;

    uint256 private _invariant;

    constructor(
        IVault _vault,
        address _strategy,
        IVault.StrategyType strategyType,
        uint256 initialBPT,
        IERC20[] memory tokens,
        uint128[] memory amounts,
        address from
    ) {
        bytes32 _poolId = _vault.newPool(_strategy, strategyType);
        _vault.addLiquidity(_poolId, from, tokens, amounts, false);

        _mintPoolShare(initialBPT);
        _pushPoolShare(from, initialBPT);

        // Set immutable state variables - these cannot be read from during construction
        vault = _vault;
        poolId = _poolId;
        strategy = _strategy;

        //Update invariant
        _invariant = StrategyInvariant(_strategy).getInvariant(amounts);
    }

    // Pays protocol fees
    function payProtocolFees() internal {
        //Load tokens
        IERC20[] memory tokens = vault.getPoolTokens(poolId);
        //Load balances
        uint128[] memory balances = vault.getPoolTokenBalances(poolId, tokens);

        //Get new invariant
        uint256 newInvariant = StrategyInvariant(strategy).getInvariant(balances);

        //Calculates how much it grew
        if (newInvariant > _invariant) {
            //Calculates ratio
            uint128 increaseRatio = FixedPoint.ONE.sub(_invariant.div(newInvariant)).toUint128();

            //Updates the invariant
            _invariant = newInvariant;

            uint128[] memory swapFeesCollected = new uint128[](tokens.length);

            //TODO: pick random token, temporary using first token
            swapFeesCollected[0] = balances[0].mul128(increaseRatio);
            vault.collectSwapProtocolFees(poolId, tokens, swapFeesCollected);
        }
    }

    // Joining a pool
    // poolAmountOut - how much bpt the user expects to get
    // maxAmountsIn - the max amounts of each token the user is willing to add to the vault
    // The set of tokens is not specified because it is read from the Vault - and remains immutable that way.
    function joinPool(
        uint256 poolAmountOut,
        uint128[] calldata maxAmountsIn,
        bool transferTokens,
        address beneficiary
    ) external nonReentrant {
        //Pay protocol fees to have balances up to date
        payProtocolFees();

        uint256 poolTotal = totalSupply();
        uint128 ratio = poolAmountOut.div(poolTotal).toUint128();
        require(ratio != 0, "ERR_MATH_APPROX");

        IERC20[] memory tokens = vault.getPoolTokens(poolId);
        uint128[] memory balances = vault.getPoolTokenBalances(poolId, tokens);

        require(maxAmountsIn.length == tokens.length, "Tokens and amounts length mismatch");

        uint128[] memory amountsIn = new uint128[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amountsIn[i] = balances[i].mul128(ratio);
            require(amountsIn[i] <= maxAmountsIn[i], "ERR_LIMIT_IN");
        }

        vault.addLiquidity(poolId, msg.sender, tokens, amountsIn, !transferTokens);

        _mintPoolShare(poolAmountOut);
        _pushPoolShare(beneficiary, poolAmountOut);
    }

    function exitPool(
        uint256 poolAmountIn,
        uint256[] calldata minAmountsOut,
        bool withdrawTokens,
        address beneficiary
    ) external nonReentrant {
        //Pay protocol fees to have balances up to date
        payProtocolFees();

        uint256 poolTotal = totalSupply();
        uint128 ratio = poolAmountIn.div(poolTotal).toUint128();
        require(ratio != 0, "ERR_MATH_APPROX");

        IERC20[] memory tokens = vault.getPoolTokens(poolId);
        uint128[] memory balances = vault.getPoolTokenBalances(poolId, tokens);

        require(minAmountsOut.length == tokens.length, "Tokens and amounts length mismatch");

        uint128[] memory amountsOut = new uint128[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amountsOut[i] = balances[i].mul128(ratio);
            require(amountsOut[i] >= minAmountsOut[i], "NOT EXITING ENOUGH");
        }

        vault.removeLiquidity(poolId, beneficiary, tokens, amountsOut, !withdrawTokens);

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
