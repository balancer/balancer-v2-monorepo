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
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../vendor/EnumerableSet.sol";

import "./IVault.sol";
import "./CashInvestedBalance.sol";
import "./PoolBalance.sol";
import "./VaultAccounting.sol";
import "./UserBalance.sol";

abstract contract PoolRegistry is ReentrancyGuard, IVault, VaultAccounting, UserBalance, PoolBalance {
    using EnumerableSet for EnumerableSet.BytesSet;

    using CashInvestedBalance for bytes32;

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

    modifier withExistingPool(bytes32 poolId) {
        require(_pools.contains(poolId), "Inexistent pool");
        _;
    }

    // operators are allowed to use a pools tokens for an investment
    mapping(bytes32 => mapping(IERC20 => address)) private _poolInvestmentManagers;

    event AuthorizedPoolInvestmentManager(bytes32 indexed poolId, IERC20 indexed token, address indexed operator);
    event RevokedPoolInvestmentManager(bytes32 indexed poolId, IERC20 indexed token, address indexed operator);

    modifier onlyPoolController(bytes32 poolId) {
        require(_poolController[poolId] == msg.sender, "Caller is not the pool controller");
        _;
    }

    function toPoolId(
        address strategy,
        uint16 strategyType,
        uint32 poolIndex
    ) public pure returns (bytes32) {
        uint256 serialized;
        serialized |= uint256(poolIndex) << (22 * 8);
        serialized |= uint256(strategyType) << (20 * 8);
        serialized |= uint256(strategy);
        return bytes32(serialized);
    }

    function fromPoolId(bytes32 serialized) public pure returns (address strategy, StrategyType strategyType) {
        //|| 6 bytes empty | 4 bytes count of pools | 2 bytes strategyType | 20 bytes address ||
        strategy = address(uint256(serialized) & (2**(20 * 8) - 1));
        strategyType = StrategyType(uint256(serialized >> (20 * 8)) & (2**(2 * 8) - 1));
    }

    function newPool(address strategy, StrategyType strategyType) external override returns (bytes32) {
        bytes32 poolId = toPoolId(strategy, uint16(strategyType), uint32(_pools.length()));

        require(!_pools.contains(poolId), "Pool ID already exists");
        require(strategy != address(0), "Strategy must be set");

        _pools.add(poolId);
        _poolController[poolId] = msg.sender;

        emit PoolCreated(poolId);

        return poolId;
    }

    function getTotalPools() external view override returns (uint256) {
        return _pools.length();
    }

    function getPoolIds(uint256 start, uint256 end) external view override returns (bytes32[] memory) {
        require((end >= start) && (end - start) <= _pools.length(), "Bad indices");

        bytes32[] memory poolIds = new bytes32[](end - start);
        for (uint256 i = 0; i < poolIds.length; ++i) {
            poolIds[i] = _pools.at(i + start);
        }

        return poolIds;
    }

    function getPoolTokens(bytes32 poolId) external view override withExistingPool(poolId) returns (IERC20[] memory) {
        (, StrategyType strategyType) = fromPoolId(poolId);

        return _getPoolTokens(poolId, strategyType);
    }

    function getPoolTokenBalances(bytes32 poolId, IERC20[] calldata tokens)
        external
        view
        override
        withExistingPool(poolId)
        returns (uint128[] memory)
    {
        (, StrategyType strategyType) = fromPoolId(poolId);

        uint128[] memory balances = new uint128[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            balances[i] = _getPoolTokenBalance(poolId, strategyType, tokens[i]).total();
        }

        return balances;
    }

    function getPoolController(bytes32 poolId) external view override withExistingPool(poolId) returns (address) {
        return _poolController[poolId];
    }

    function getPoolStrategy(bytes32 poolId)
        external
        view
        override
        withExistingPool(poolId)
        returns (address, StrategyType)
    {
        (address strategy, StrategyType strategyType) = fromPoolId(poolId);
        return (strategy, strategyType);
    }

    function setPoolController(bytes32 poolId, address controller)
        external
        override
        nonReentrant
        withExistingPool(poolId)
        onlyPoolController(poolId)
    {
        _poolController[poolId] = controller;
    }

    function addLiquidity(
        bytes32 poolId,
        address from,
        IERC20[] calldata tokens,
        uint128[] calldata amounts,
        bool withdrawFromUserBalance
    ) external override withExistingPool(poolId) onlyPoolController(poolId) {
        require(tokens.length == amounts.length, "Tokens and total amounts length mismatch");

        require(isOperatorFor(from, msg.sender), "Caller is not operator");

        (, StrategyType strategyType) = fromPoolId(poolId);

        for (uint256 i = 0; i < tokens.length; ++i) {
            if (amounts[i] > 0) {
                uint128 toReceive = amounts[i];
                if (withdrawFromUserBalance) {
                    uint128 toWithdraw = uint128(Math.min(_userTokenBalance[from][tokens[i]], toReceive));

                    _userTokenBalance[from][tokens[i]] -= toWithdraw;
                    toReceive -= toWithdraw;
                }

                uint128 received = _pullTokens(tokens[i], from, toReceive);
                require(received == toReceive, "Not enough tokens received");

                _increasePoolCash(poolId, strategyType, tokens[i], amounts[i]);
            }
        }
    }

    function removeLiquidity(
        bytes32 poolId,
        address to,
        IERC20[] calldata tokens,
        uint128[] calldata amounts,
        bool depositToUserBalance
    ) external override withExistingPool(poolId) onlyPoolController(poolId) {
        require(tokens.length == amounts.length, "Tokens and total amounts length mismatch");

        (, StrategyType strategyType) = fromPoolId(poolId);

        for (uint256 i = 0; i < tokens.length; ++i) {
            if (amounts[i] > 0) {
                if (depositToUserBalance) {
                    // Deposit tokens to the recipient's User Balance - the Vault's balance doesn't change
                    _userTokenBalance[to][tokens[i]] = _userTokenBalance[to][tokens[i]].add128(amounts[i]);
                } else {
                    // Actually transfer the tokens to the recipient
                    _pushTokens(tokens[i], to, amounts[i], true);
                }

                _decreasePoolCash(poolId, strategyType, tokens[i], amounts[i]);
            }
        }
    }

    // Investments

    modifier onlyPoolInvestmentManager(bytes32 poolId, IERC20 token) {
        require(_isPoolInvestmentManager(poolId, token, msg.sender), "SENDER_NOT_INVESTMENT_MANAGER");
        _;
    }

    function authorizePoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address manager
    ) external override onlyPoolController(poolId) {
        bool missing = _poolInvestmentManagers[poolId][token] == address(0);
        (, StrategyType strategyType) = fromPoolId(poolId);
        require(missing || _isPoolInvested(poolId, strategyType, token), "CANNOT_SET_INVESTMENT_MANAGER");

        _poolInvestmentManagers[poolId][token] = manager;
        emit AuthorizedPoolInvestmentManager(poolId, token, manager);
    }

    function revokePoolInvestmentManager(bytes32 poolId, IERC20 token) external override onlyPoolController(poolId) {
        address currentManager = _poolInvestmentManagers[poolId][token];
        bool exists = currentManager != address(0);
        (, StrategyType strategyType) = fromPoolId(poolId);
        require(exists && _isPoolInvested(poolId, strategyType, token), "CANNOT_REVOKE_INVESTMENT_MANAGER");

        delete _poolInvestmentManagers[poolId][token];
        emit RevokedPoolInvestmentManager(poolId, token, currentManager);
    }

    function isPoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address account
    ) external view returns (bool) {
        return _isPoolInvestmentManager(poolId, token, account);
    }

    function investPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token) {
        (, StrategyType strategyType) = fromPoolId(poolId);
        _investPoolCash(poolId, strategyType, token, amount);

        _pushTokens(token, msg.sender, amount, false);
    }

    function divestPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token) {
        // TODO: Think about what happens with tokens that charge a transfer fee
        uint128 divestedAmount = _pullTokens(token, msg.sender, amount);

        (, StrategyType strategyType) = fromPoolId(poolId);
        _divestPoolCash(poolId, strategyType, token, divestedAmount);
    }

    function updateInvested(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token) {
        (, StrategyType strategyType) = fromPoolId(poolId);
        _setPoolInvestment(poolId, strategyType, token, amount);
    }

    function _isPoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address account
    ) internal view returns (bool) {
        return _poolInvestmentManagers[poolId][token] == account;
    }
}
