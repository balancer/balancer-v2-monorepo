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

import "./vault/IVault.sol";
import "./BToken.sol";

// Initial implementation implements a simple, pass-through sole proprietorship model
// for pool governance
contract BasePoolTokenizer is BToken {
    IVault public immutable vault;
    bytes32 public poolID;

    constructor(IVault _vault) {
        vault = _vault;
    }

    modifier _lock_() {
        require(!_mutex, "ERR_REENTRY");
        _mutex = true;
        _;
        _mutex = false;
    }

    bool private _mutex;

    // Joining a pool
    // poolAmountOut - how much bpt the user expects to get
    // maxAmountsIn - the max amounts of each token the user is willing to add to the vault
    function joinPool(uint256 poolAmountOut, uint256[] calldata maxAmountsIn)
        external
        _lock_
    {
        uint256 poolTotal = totalSupply();
        uint256 ratio = bdiv(poolAmountOut, poolTotal);
        require(ratio != 0, "ERR_MATH_APPROX");

        address[] memory tokens = vault.getPoolTokens(poolID);
        uint128[] memory balances = vault.getPoolTokenBalances(poolID, tokens);

        uint256[] memory amountsIn = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amountsIn[i] = bmul(balances[i], ratio);
            require(amountsIn[i] <= maxAmountsIn[i], "ERR_LIMIT_IN");

            bool xfer = IERC20(tokens[i]).transferFrom(
                msg.sender,
                address(vault),
                amountsIn[i]
            );
            require(xfer, "transfer must succeed");
        }

        vault.addLiquidity(poolID, amountsIn);

        _mintPoolShare(poolAmountOut);
        _pushPoolShare(msg.sender, poolAmountOut);
    }

    function exitPool(uint256 poolAmountIn, uint256[] calldata minAmountsOut)
        external
        _lock_
    {
        uint256 poolTotal = totalSupply();
        uint256 ratio = bdiv(poolAmountIn, poolTotal);
        require(ratio != 0, "ERR_MATH_APPROX");

        address[] memory tokens = vault.getPoolTokens(poolID);
        uint128[] memory balances = vault.getPoolTokenBalances(poolID, tokens);

        uint256[] memory amountsOut = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amountsOut[i] = bmul(balances[i], ratio);
            require(amountsOut[i] >= minAmountsOut[i], "NOT EXITING ENOUGH");
        }

        _pullPoolShare(msg.sender, poolAmountIn);
        _burnPoolShare(poolAmountIn);

        vault.removeLiquidity(poolID, msg.sender, amountsOut);
    }

    // Add initial liquidity

    function _addInitialLiquidity(
        uint256 initialBPT,
        address[] memory initialTokens,
        uint256[] memory initialBalances
    ) internal {
        for (uint256 i = 0; i < initialTokens.length; i++) {
            address t = initialTokens[i];
            uint256 amountIn = initialBalances[i];
            IERC20(t).transferFrom(msg.sender, address(vault), amountIn);
        }

        vault.addInitialLiquidity(poolID, initialTokens, initialBalances);
        _mintPoolShare(initialBPT);
        _pushPoolShare(msg.sender, initialBPT);
    }

    // 'Underlying' token-manipulation functions make external calls but are NOT locked
    // You must `_lock_` or otherwise ensure reentry-safety

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
