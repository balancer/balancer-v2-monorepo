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

import "hardhat/console.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

import "../../math/FixedPoint.sol";

import "./CashInvested.sol";

contract SimplifiedQuotePoolsBalance {
    using EnumerableSet for EnumerableSet.AddressSet;
    using CashInvested for bytes32;

    // Data for Pools with Simplified Quote Pool Optimization setting
    //
    // These Pools use the IPairTradingStrategy interface, and so the Vault must read the balance of the two tokens in
    // the swap. The best solution is to use a mapping from token to balance, which lets us read or write any token's
    // balance in a  single storage access.
    // We also keep a set with all tokens in the Pool in order to implement getPoolTokens, and update this set when
    // cash is added or removed from the pool. Tokens in the set always have a non-zero balance, so we don't need to
    // check the set for token existence during a swap: the non-zero balance check achieves this for less gas.

    mapping(bytes32 => EnumerableSet.AddressSet) internal _simplifiedQuotePoolsTokens;
    mapping(bytes32 => mapping(IERC20 => bytes32)) internal _simplifiedQuotePoolsBalances;

    /**
     * @dev Returns an array with all the tokens in a Simplified Quote Pool. This order may change when tokens are added to or
     * removed from the Pool.
     */
    function _getSimplifiedQuotePoolTokens(bytes32 poolId) internal view returns (IERC20[] memory) {
        IERC20[] memory tokens = new IERC20[](_simplifiedQuotePoolsTokens[poolId].length());

        for (uint256 i = 0; i < tokens.length; ++i) {
            tokens[i] = IERC20(_simplifiedQuotePoolsTokens[poolId].at(i));
        }

        return tokens;
    }

    /**
     * @dev Returns the balance for a token in a Simplified Quote Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     */
    function _getSimplifiedQuotePoolTokenBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        bytes32 balance = _simplifiedQuotePoolsBalances[poolId][token];
        require(balance.total() > 0, "Token not in pool");

        return balance;
    }

    /**
     * @dev Adds cash to a Simplified Quote Pool for a given token. If the token was not previously in the Pool (if it didn't have
     * any funds for it), the token is then added to the Pool. After this function is called, 'token' will be in the
     * Pool.
     *
     * Requirements:
     *
     * - if `token` is not in the Pool, `amount` must be non-zero.
     */
    function _increaseSimplifiedQuotePoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        bytes32 currentBalance;

        // Alternatively we could check for non-zero balance
        if (_simplifiedQuotePoolsTokens[poolId].contains(address(token))) {
            currentBalance = _simplifiedQuotePoolsBalances[poolId][token];
        } else {
            // New token - we add it to the set
            _simplifiedQuotePoolsTokens[poolId].add(address(token));

            require(amount > 0, "New token amount is zero");
            currentBalance = CashInvested.toBalance(0, 0);
        }

        _simplifiedQuotePoolsBalances[poolId][token] = currentBalance.increaseCash(amount);
    }

    /**
     * @dev Removes cash from a Simplified Quote Pool for a given token. If this fully drains the Pool's balance for that token
     * (including invested balance), then the token is removed from the Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     * - `amount` must be less or equal than the Pool's cash for that token.
     */
    function _decreaseSimplifiedQuotePoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        // Alternatively we could check for non-zero balance
        require(_simplifiedQuotePoolsTokens[poolId].contains(address(token)), "Token not in pool");

        bytes32 currentBalance = _simplifiedQuotePoolsBalances[poolId][token];
        bytes32 newBalance = currentBalance.decreaseCash(amount);

        _simplifiedQuotePoolsBalances[poolId][token] = newBalance;

        if (newBalance.total() == 0) {
            _simplifiedQuotePoolsTokens[poolId].remove(address(token));
        }
    }

    function _investSimplifiedQuotePoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        bytes32 currentBalance = _simplifiedQuotePoolsBalances[poolId][token];
        require(currentBalance.total() > 0, "Token not in pool");
        _simplifiedQuotePoolsBalances[poolId][token] = currentBalance.cashToInvested(amount);
    }

    function _divestSimplifiedQuotePoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        bytes32 currentBalance = _simplifiedQuotePoolsBalances[poolId][token];
        require(currentBalance.total() > 0, "Token not in pool");
        _simplifiedQuotePoolsBalances[poolId][token] = currentBalance.investedToCash(amount);
    }

    function _setSimplifiedQuotePoolInvestment(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        bytes32 currentBalance = _simplifiedQuotePoolsBalances[poolId][token];
        require(currentBalance.total() > 0, "Token not in pool");
        _simplifiedQuotePoolsBalances[poolId][token] = currentBalance.setInvested(amount);
    }

    function _isSimplifiedQuotePoolInvested(bytes32 poolId, IERC20 token) internal view returns (bool) {
        return _simplifiedQuotePoolsBalances[poolId][token].isInvested();
    }
}
