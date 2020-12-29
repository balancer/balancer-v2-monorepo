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

contract PairPoolsBalance {
    using EnumerableSet for EnumerableSet.AddressSet;
    using CashInvested for bytes32;

    // Data for Pools with Pair Trading Strategies
    //
    // When swapping with these Pools, the Vault must provide the balance of the two tokens in the swap. The best
    // solution is to use a mapping from token to balance, which lets us read or write any token's balance in a  single
    // storage access.
    // We also keep a set with all tokens in the Pool in order to implement getPoolTokens, and update this set when
    // cash is added or removed from the pool. Tokens in the set always have a non-zero balance, so we don't need to
    // check the set for token existence during a swap: the non-zero balance check achieves this for less gas.

    mapping(bytes32 => EnumerableSet.AddressSet) internal _poolPairTokens;
    mapping(bytes32 => mapping(IERC20 => bytes32)) internal _poolPairTokenBalance;

    /**
     * @dev Returns an array with all the tokens in a Pair Pool. This order may change when tokens are added to or
     * removed from the Pool.
     */
    function _getPairPoolTokens(bytes32 poolId) internal view returns (IERC20[] memory) {
        IERC20[] memory tokens = new IERC20[](_poolPairTokens[poolId].length());

        for (uint256 i = 0; i < tokens.length; ++i) {
            tokens[i] = IERC20(_poolPairTokens[poolId].at(i));
        }

        return tokens;
    }

    /**
     * @dev Returns the balance for a token in a Pair Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     */
    function _getPairPoolTokenBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        bytes32 balance = _poolPairTokenBalance[poolId][token];
        require(balance.total() > 0, "Token not in pool");

        return balance;
    }

    /**
     * @dev Adds cash to a Pair Pool for a given token. If the token was not previously in the Pool (if it didn't have
     * any funds for it), the token is then added to the Pool. After this function is called, 'token' will be in the
     * Pool.
     *
     * Requirements:
     *
     * - if `token` is not in the Pool, `amount` must be non-zero.
     */
    function _increasePairPoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        bytes32 currentBalance;

        // Alternatively we could check for non-zero balance
        if (_poolPairTokens[poolId].contains(address(token))) {
            currentBalance = _poolPairTokenBalance[poolId][token];
        } else {
            // New token - we add it to the set
            _poolPairTokens[poolId].add(address(token));

            require(amount > 0, "New token amount is zero");
            currentBalance = CashInvested.toBalance(0, 0);
        }

        _poolPairTokenBalance[poolId][token] = currentBalance.increaseCash(amount);
    }

    /**
     * @dev Removes cash from a Pair Pool for a given token. If this fully drains the Pool's balance for that token
     * (including invested balance), then the token is removed from the Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     * - `amount` must be less or equal than the Pool's cash for that token.
     */
    function _decreasePairPoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        // Alternatively we could check for non-zero balance
        require(_poolPairTokens[poolId].contains(address(token)), "Token not in pool");

        bytes32 currentBalance = _poolPairTokenBalance[poolId][token];
        bytes32 newBalance = currentBalance.decreaseCash(amount);

        _poolPairTokenBalance[poolId][token] = newBalance;

        if (newBalance.total() == 0) {
            _poolPairTokens[poolId].remove(address(token));
        }
    }

    function _investPairPoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        bytes32 currentBalance = _poolPairTokenBalance[poolId][token];
        require(currentBalance.total() > 0, "Token not in pool");
        _poolPairTokenBalance[poolId][token] = currentBalance.cashToInvested(amount);
    }

    function _divestPairPoolCash(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        bytes32 currentBalance = _poolPairTokenBalance[poolId][token];
        require(currentBalance.total() > 0, "Token not in pool");
        _poolPairTokenBalance[poolId][token] = currentBalance.investedToCash(amount);
    }

    function _setPairPoolInvestment(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) internal {
        bytes32 currentBalance = _poolPairTokenBalance[poolId][token];
        require(currentBalance.total() > 0, "Token not in pool");
        _poolPairTokenBalance[poolId][token] = currentBalance.setInvested(amount);
    }

    function _isPairPoolInvested(bytes32 poolId, IERC20 token) internal view returns (bool) {
        return _poolPairTokenBalance[poolId][token].isInvested();
    }
}
