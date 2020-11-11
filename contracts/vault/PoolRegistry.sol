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
import "../vendor/EnumerableSet.sol";

import "../utils/Lock.sol";
import "../utils/Logs.sol";

import "./IVault.sol";
import "./VaultAccounting.sol";
import "./UserBalance.sol";
import "../investmentManagers/IInvestmentManager.sol";

abstract contract PoolRegistry is IVault, VaultAccounting, UserBalance, Lock, Logs {
    using EnumerableSet for EnumerableSet.BytesSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    using BalanceLib for BalanceLib.Balance;

    using FixedPoint for uint128;

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
    mapping(bytes32 => mapping(IERC20 => BalanceLib.Balance)) internal _poolTokenBalance;
    // poolid => token => pool balance

    modifier withExistingPool(bytes32 poolId) {
        require(_pools.contains(poolId), "Inexistent pool");
        _;
    }

    // investable percentage per token
    mapping(bytes32 => mapping(IERC20 => uint128)) internal _investablePercentage;

    // operators are allowed to use a pools tokens for an investment
    mapping(bytes32 => mapping(IERC20 => address)) private _poolInvestmentManagers;

    event AuthorizedPoolInvestmentManager(bytes32 indexed poolId, IERC20 indexed token, address indexed operator);
    event RevokedPoolInvestmentManager(bytes32 indexed poolId, IERC20 indexed token, address indexed operator);

    modifier onlyPoolController(bytes32 poolId) {
        require(_poolController[poolId] == msg.sender, "Caller is not the pool controller");
        _;
    }

    function newPool(address strategy, StrategyType strategyType) external override returns (bytes32) {
        bytes32 poolId = keccak256(abi.encodePacked(address(this), _pools.length()));

        require(!_pools.contains(poolId), "Pool ID already exists");
        require(strategy != address(0), "Strategy must be set");

        _pools.add(poolId);
        _poolController[poolId] = msg.sender;
        _poolStrategy[poolId] = PoolStrategy({ strategy: strategy, strategyType: strategyType });

        emit PoolCreated(poolId);

        return poolId;
    }

    function getTotalPools() external view override returns (uint256) {
        return _pools.length();
    }

    function getPoolIds(uint256 start, uint256 end) external view override _viewlock_ returns (bytes32[] memory) {
        require((end >= start) && (end - start) <= _pools.length(), "Bad indices");

        bytes32[] memory poolIds = new bytes32[](end - start);
        for (uint256 i = 0; i < poolIds.length; ++i) {
            poolIds[i] = _pools.at(i + start);
        }

        return poolIds;
    }

    function getPoolTokens(bytes32 poolId)
        external
        view
        override
        _viewlock_
        withExistingPool(poolId)
        returns (IERC20[] memory)
    {
        IERC20[] memory tokens = new IERC20[](_poolTokens[poolId].length());
        for (uint256 i = 0; i < tokens.length; ++i) {
            tokens[i] = IERC20(_poolTokens[poolId].at(i));
        }

        return tokens;
    }

    function getPoolTokenBalances(bytes32 poolId, IERC20[] calldata tokens)
        external
        view
        override
        withExistingPool(poolId)
        returns (uint128[] memory)
    {
        uint128[] memory balances = new uint128[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            balances[i] = _poolTokenBalance[poolId][tokens[i]].total;
        }

        return balances;
    }

    function getPoolController(bytes32 poolId)
        external
        view
        override
        withExistingPool(poolId)
        _viewlock_
        returns (address)
    {
        return _poolController[poolId];
    }

    function getPoolStrategy(bytes32 poolId)
        external
        view
        override
        withExistingPool(poolId)
        _viewlock_
        returns (address, StrategyType)
    {
        PoolStrategy memory strategy = _poolStrategy[poolId];
        return (strategy.strategy, strategy.strategyType);
    }

    function setPoolController(bytes32 poolId, address controller)
        external
        override
        _logs_
        _lock_
        withExistingPool(poolId)
        onlyPoolController(poolId)
    {
        _poolController[poolId] = controller;
    }

    function setPoolStrategy(
        bytes32 poolId,
        address strategy,
        StrategyType strategyType
    ) external override _logs_ _lock_ withExistingPool(poolId) onlyPoolController(poolId) {
        // The Pool registry will store token information in different formats depending on the strategy type,
        // so changing it is disallowed
        require(strategyType == _poolStrategy[poolId].strategyType, "Trading strategy type cannot change");

        _poolStrategy[poolId] = PoolStrategy({ strategy: strategy, strategyType: strategyType });
    }

    function addLiquidity(
        bytes32 poolId,
        address from,
        IERC20[] calldata tokens,
        uint128[] calldata totalAmounts,
        uint128[] calldata amountsToTransfer
    ) external override withExistingPool(poolId) onlyPoolController(poolId) {
        require(tokens.length == totalAmounts.length, "Tokens and total amounts length mismatch");

        require(totalAmounts.length == amountsToTransfer.length, "Amount arrays length mismatch");

        require(isOperatorFor(from, msg.sender), "Caller is not operator");

        for (uint256 i = 0; i < tokens.length; ++i) {
            {
                // scope for received - avoids 'stack too deep' error

                uint128 received = _pullTokens(tokens[i], from, amountsToTransfer[i]);

                {
                    // scope for amountFromuserBalance - avoids 'stack too deep' error

                    // This checks totalAmounts[i] >= amountsTransferred[i] (assuming amountsTransferred[i] >= received)
                    uint128 amountFromUserBalance = totalAmounts[i].sub128(received);

                    if (amountFromUserBalance > 0) {
                        _userTokenBalance[from][tokens[i]] = _userTokenBalance[from][tokens[i]].sub128(
                            amountFromUserBalance
                        );
                    }
                }
            }

            if (totalAmounts[i] > 0) {
                BalanceLib.Balance memory currentBalance = _poolTokenBalance[poolId][tokens[i]];

                if (currentBalance.total == 0) {
                    // No tokens with zero balance should ever be in the _poolTokens set
                    assert(_poolTokens[poolId].add(address(tokens[i])));
                }

                _poolTokenBalance[poolId][tokens[i]] = _poolTokenBalance[poolId][tokens[i]].increase(totalAmounts[i]);
            }
        }
    }

    function removeLiquidity(
        bytes32 poolId,
        address to,
        IERC20[] calldata tokens,
        uint128[] calldata totalAmounts,
        uint128[] calldata amountsToTransfer
    ) external override withExistingPool(poolId) onlyPoolController(poolId) {
        require(tokens.length == totalAmounts.length, "Tokens and total amounts length mismatch");

        require(totalAmounts.length == amountsToTransfer.length, "Amount arrays length mismatch");

        for (uint256 i = 0; i < tokens.length; ++i) {
            require(_poolTokens[poolId].contains(address(tokens[i])), "Token not in pool");

            // This asserts  totalAmounts[i] >= amountsToTransfer[i]
            uint128 amountToUserBalance = totalAmounts[i].sub128(amountsToTransfer[i]);

            _pushTokens(tokens[i], to, amountsToTransfer[i], true);

            if (amountToUserBalance > 0) {
                _userTokenBalance[to][tokens[i]] = _userTokenBalance[to][tokens[i]].add128(amountToUserBalance);
            }

            _poolTokenBalance[poolId][tokens[i]] = _poolTokenBalance[poolId][tokens[i]].decrease(totalAmounts[i]);

            if (_poolTokenBalance[poolId][tokens[i]].total == 0) {
                _poolTokens[poolId].remove(address(tokens[i]));
            }
        }
    }

    function getInvestablePercentage(bytes32 poolId, IERC20 token)
        external
        view
        override
        _viewlock_
        withExistingPool(poolId)
        returns (uint128)
    {
        return _investablePercentage[poolId][token];
    }

    function setInvestablePercentage(
        bytes32 poolId,
        IERC20 token,
        uint128 percentage
    ) external override _logs_ _lock_ withExistingPool(poolId) onlyPoolController(poolId) {
        require(percentage <= FixedPoint.ONE, "Percentage must be between 0 and 100%");
        _investablePercentage[poolId][token] = percentage;
    }

    function authorizePoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address operator
    ) external override onlyPoolController(poolId) {
        require(
            _poolInvestmentManagers[poolId][token] == address(0) ||
                _poolTokenBalance[poolId][token].cash == _poolTokenBalance[poolId][token].total,
            "Cannot set a new investment manager with outstanding investment"
        );
        _poolInvestmentManagers[poolId][token] = operator;
        emit AuthorizedPoolInvestmentManager(poolId, token, operator);
    }

    function revokePoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address operator
    ) external override onlyPoolController(poolId) {
        require(
            _poolInvestmentManagers[poolId][token] != address(0) &&
                _poolTokenBalance[poolId][token].cash == _poolTokenBalance[poolId][token].total,
            "Cannot remove an investment manager with outstanding investment"
        );

        delete _poolInvestmentManagers[poolId][token];
        emit RevokedPoolInvestmentManager(poolId, token, operator);
    }

    modifier onlyPoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address operator
    ) {
        require(isPoolInvestmentManager(poolId, token, operator), "Only pool investment operator");
        _;
    }

    function isPoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address operator
    ) public view returns (bool) {
        return _poolInvestmentManagers[poolId][token] == operator;
    }

    // Investments
    // how the investment manager receives more tokens to invest
    // callable by anyone
    function investPoolBalance(
        bytes32 poolId,
        IERC20 token,
        address investmentManager,
        uint128 amountToInvest // must be less than total allowed
    ) public onlyPoolInvestmentManager(poolId, token, investmentManager) {
        uint128 targetUtilization = _investablePercentage[poolId][token];
        uint128 targetInvestableAmount = _poolTokenBalance[poolId][token].total.mul128(targetUtilization);

        uint128 investedAmount = _poolTokenBalance[poolId][token].invested();

        require(
            investedAmount.add128(amountToInvest) <= targetInvestableAmount,
            "over investment amount - cannot invest"
        );

        _poolTokenBalance[poolId][token].cash = _poolTokenBalance[poolId][token].cash.sub128(amountToInvest);

        _pushTokens(token, investmentManager, amountToInvest, false);
        IInvestmentManager(investmentManager).recordPoolInvestment(poolId, amountToInvest);
    }

    function divestPoolBalance(
        bytes32 poolId,
        IERC20 token,
        address investmentManager,
        uint128 amountToDivest // must be less than total allowed
    ) public onlyPoolInvestmentManager(poolId, token, investmentManager) {
        uint128 targetUtilization = _investablePercentage[poolId][token];
        uint128 targetInvestableAmount = _poolTokenBalance[poolId][token].total.mul128(targetUtilization);
        uint128 investedAmount = _poolTokenBalance[poolId][token].invested();
        require(
            investedAmount.sub128(amountToDivest) >= targetInvestableAmount,
            "under investment amount - cannot divest"
        );

        _poolTokenBalance[poolId][token].cash = _poolTokenBalance[poolId][token].cash.add128(amountToDivest);

        // think about what happens with tokens that charge a transfer fee
        _pullTokens(token, investmentManager, amountToDivest);
        IInvestmentManager(investmentManager).recordPoolDivestment(poolId, amountToDivest);
    }

    function rebalancePoolInvestment(
        bytes32 poolId,
        IERC20 token,
        address investmentManager
    ) public onlyPoolInvestmentManager(poolId, token, investmentManager) {
        uint128 targetUtilization = _investablePercentage[poolId][token];
        uint128 targetInvestableAmount = _poolTokenBalance[poolId][token].total.mul128(targetUtilization);
        uint128 investedAmount = _poolTokenBalance[poolId][token].invested();

        if (targetInvestableAmount > investedAmount) {
            uint128 amountToInvest = targetInvestableAmount.sub128(investedAmount);
            _poolTokenBalance[poolId][token].cash = _poolTokenBalance[poolId][token].cash.sub128(amountToInvest);

            _pushTokens(token, investmentManager, amountToInvest, false);
            IInvestmentManager(investmentManager).recordPoolInvestment(poolId, amountToInvest);
        } else if (targetInvestableAmount < investedAmount) {
            uint128 amountToDivest = investedAmount.sub128(targetInvestableAmount);
            _poolTokenBalance[poolId][token].cash = _poolTokenBalance[poolId][token].cash.add128(amountToDivest);

            // think about what happens with tokens that charge a transfer fee
            _pullTokens(token, investmentManager, amountToDivest);
            IInvestmentManager(investmentManager).recordPoolDivestment(poolId, amountToDivest);
        } else {
            revert("Pool balance is already balanced between cash and investment");
        }
    }

    // how the investment manager updates the value of invested tokens to the curves knowledge
    function updateInvested(
        bytes32 poolId,
        IERC20 token,
        uint128 amountInvested
    ) public override onlyPoolInvestmentManager(poolId, token, msg.sender) {
        _poolTokenBalance[poolId][token].total = amountInvested.add128(_poolTokenBalance[poolId][token].cash);
    }
}
