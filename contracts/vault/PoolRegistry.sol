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

import "./vendor/EnumerableSet.sol";

import "../utils/Lock.sol";
import "../utils/Logs.sol";
import "../BConst.sol";

import "./IVault.sol";
import "./VaultAccounting.sol";

abstract contract PoolRegistry is IVault, VaultAccounting, BConst, Lock, Logs {
    using EnumerableSet for EnumerableSet.BytesSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    using BalanceLib for BalanceLib.Balance;

    struct PoolStrategy {
        address strategy;
        StrategyType strategyType;
    }

    // Set with all pools in the system
    // TODO do we need this? can pools be deleted? if not, an array should be good enough
    EnumerableSet.BytesSet internal _pools;

    // The controller of a pool is the only account that can:
    //  - change the controller
    //  - change the trading strategy
    //  - add tokens
    //  - remove tokens
    // The creator of a pool is the initial controller.
    mapping(bytes32 => address) internal _poolController;

    mapping(bytes32 => PoolStrategy) internal _poolStrategy;

    // Set with all tokens in a pool
    mapping(bytes32 => EnumerableSet.AddressSet) internal _poolTokens;

    // Tokens in a pool have non-zero balances, which can be used as a shortcut to check
    // at once if a) a pool exists and b) a token is in that pool.
    mapping(bytes32 => mapping(address => BalanceLib.Balance))
        internal _poolTokenBalance; // poolid => token => pool balance

    modifier withExistingPool(bytes32 poolId) {
        require(_pools.contains(poolId), "Inexistent pool");
        _;
    }

    modifier onlyPoolController(bytes32 poolId) {
        require(
            _poolController[poolId] == msg.sender,
            "Caller is not the pool controller"
        );
        _;
    }

    event PoolCreated(bytes32 poolId);

    function newPool(
        bytes32 poolId,
        address strategy,
        StrategyType strategyType
    ) external override returns (bytes32) {
        require(!_pools.contains(poolId), "Pool ID already exists");
        require(strategy != address(0), "Strategy must be set");

        _pools.add(poolId);
        _poolController[poolId] = msg.sender;
        _poolStrategy[poolId] = PoolStrategy({
            strategy: strategy,
            strategyType: strategyType
        });

        emit PoolCreated(poolId);

        return poolId;
    }

    function isTokenBound(bytes32 poolId, address token)
        external
        override
        view
        withExistingPool(poolId)
        returns (bool)
    {
        return _poolTokens[poolId].contains(token);
    }

    function getNumPoolTokens(bytes32 poolId)
        external
        override
        view
        withExistingPool(poolId)
        returns (uint256)
    {
        return _poolTokens[poolId].length();
    }

    function getPoolTokens(bytes32 poolId)
        external
        override
        view
        _viewlock_
        withExistingPool(poolId)
        returns (address[] memory)
    {
        uint256 totalTokens = _poolTokens[poolId].length();

        address[] memory tokens = new address[](totalTokens);
        for (uint256 i = 0; i < tokens; ++i) {
            tokens[i] = _poolTokens[poolId].at(i);
        }

        return tokens;
    }

    function getPoolTokenBalances(bytes32 poolId, address[] calldata tokens)
        external
        override
        view
        withExistingPool(poolId)
        returns (uint128[] memory)
    {
        uint128[] memory balances = new uint128[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            balances[i] = uint128(_poolTokenBalance[poolId][tokens[i]].total());
        }

        return balances;
    }

    function getController(bytes32 poolId)
        external
        override
        view
        withExistingPool(poolId)
        _viewlock_
        returns (address)
    {
        return _poolController[poolId];
    }

    function getStrategy(bytes32 poolId)
        external
        override
        view
        withExistingPool(poolId)
        _viewlock_
        returns (address, StrategyType)
    {
        PoolStrategy memory strategy = _poolStrategy[poolId];
        return (strategy.strategy, strategy.strategyType);
    }

    function setController(bytes32 poolId, address controller)
        external
        override
        _logs_
        _lock_
        withExistingPool(poolId)
        onlyPoolController(poolId)
    {
        _poolController[poolId] = controller;
    }

    function depositToPool(
        bytes32 poolId,
        address from,
        address[] calldata tokens,
        uint128[] calldata amounts
    ) external override withExistingPool(poolId) onlyPoolController(poolId) {
        require(
            tokens.length == amounts.length,
            "Tokens and amounts length mismatch"
        );

        for (uint256 i = 0; i < tokens.length; ++i) {
            uint128 received = _pullTokens(tokens[i], from, amounts[i]);
            if (received > 0) {

                    BalanceLib.Balance memory currentBalance
                 = _poolTokenBalance[poolId][tokens[i]];

                if (currentBalance.total() == 0) {
                    bool added = _poolTokens[poolId].add(tokens[i]);
                    assert(added); // No tokens with zero balance should ever be in the _poolTokens set
                }

                _poolTokenBalance[poolId][tokens[i]].cash = currentBalance
                    .cash
                    .add(received);
            }
        }
    }

    function withdrawFromPool(
        bytes32 poolId,
        address from,
        address[] calldata tokens,
        uint128[] calldata amounts
    ) external override withExistingPool(poolId) onlyPoolController(poolId) {
        require(
            tokens.length == amounts.length,
            "Tokens and amounts length mismatch"
        );

        for (uint256 i = 0; i < tokens.length; ++i) {
            require(
                _poolTokens[poolId].contains(tokens[i]),
                "Token not in pool"
            );

            _pushTokens(tokens[i], from, amounts[i]);


                BalanceLib.Balance memory currentBalance
             = _poolTokenBalance[poolId][tokens[i]];

            currentBalance.cash = currentBalance.cash.sub(amounts[i]);
            _poolTokenBalance[poolId][tokens[i]] = currentBalance;

            if (currentBalance.total() == 0) {
                _poolTokens.remove(tokens[i]);
            }
        }
    }
}
