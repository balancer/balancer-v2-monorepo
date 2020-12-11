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
import "./PoolBalance.sol";
import "./VaultAccounting.sol";
import "./UserBalance.sol";

abstract contract PoolRegistry is ReentrancyGuard, IVault, VaultAccounting, UserBalance {
    using EnumerableSet for EnumerableSet.BytesSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    using PoolBalance for bytes32;

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

    // Set with all tokens in a pool
    mapping(bytes32 => EnumerableSet.AddressSet) internal _poolTokens;

    // Tokens in a pool have non-zero balances, which can be used as a shortcut to check
    // at once if a) a pool exists and b) a token is in that pool.
    mapping(bytes32 => mapping(IERC20 => bytes32)) internal _poolTokenBalance;
    // poolid => token => pool balance

    modifier withExistingPool(bytes32 poolId) {
        require(_pools.contains(poolId), "POOL_DOES_NOT_EXIST");
        _;
    }

    // operators are allowed to use a pools tokens for an investment
    mapping(bytes32 => mapping(IERC20 => address)) private _poolInvestmentManagers;

    event AuthorizedPoolInvestmentManager(bytes32 indexed poolId, IERC20 indexed token, address indexed operator);
    event RevokedPoolInvestmentManager(bytes32 indexed poolId, IERC20 indexed token, address indexed operator);

    modifier onlyPoolController(bytes32 poolId) {
        require(_poolController[poolId] == msg.sender, "SENDER_IS_NOT_POOL_CONTROLLER");
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

        require(!_pools.contains(poolId), "POOL_ALREADY_EXISTS");
        require(strategy != address(0), "STRATEGY_ZERO_ADDRESS");

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
        EnumerableSet.AddressSet storage poolTokens = _poolTokens[poolId];
        IERC20[] memory tokens = new IERC20[](poolTokens.length());
        for (uint256 i = 0; i < tokens.length; ++i) {
            tokens[i] = IERC20(poolTokens.at(i));
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
            balances[i] = _poolTokenBalance[poolId][tokens[i]].total();
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
        require(tokens.length == amounts.length, "INVALID_TOKEN_AMOUNTS_LENGTH");
        require(isOperatorFor(from, msg.sender), "Caller is not operator");

        for (uint256 i = 0; i < tokens.length; ++i) {
            _addLiquidity(poolId, tokens[i], amounts[i], from, withdrawFromUserBalance);
        }
    }

    function _addLiquidity(bytes32 poolId, IERC20 token, uint128 toReceive, address from, bool withdrawFromUserBalance) internal {
        if (withdrawFromUserBalance) {
            uint128 toWithdraw = uint128(Math.min(_userTokenBalance[from][token], toReceive));
            _userTokenBalance[from][token] -= toWithdraw;
            toReceive -= toWithdraw;
        }

        uint128 received = _pullTokens(token, from, toReceive);
        require(received == toReceive, "Not enough tokens received");

        if (toReceive > 0) {
            bytes32 currentBalance = _poolTokenBalance[poolId][token];
            if (currentBalance.isZero()) {
                // No tokens with zero balance should ever be in the _poolTokens set
                assert(_poolTokens[poolId].add(address(token)));
            }

            _poolTokenBalance[poolId][token] = currentBalance.increaseCash(toReceive);
        }
    }

    function removeLiquidity(
        bytes32 poolId,
        address to,
        IERC20[] calldata tokens,
        uint128[] calldata amounts,
        bool depositToUserBalance
    ) external override withExistingPool(poolId) onlyPoolController(poolId) {
        require(tokens.length == amounts.length, "INVALID_TOKEN_AMOUNTS_LENGTH");
        EnumerableSet.AddressSet storage poolTokens = _poolTokens[poolId];

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            require(poolTokens.contains(address(token)), "Token not in pool");
            _removeLiquidity(poolId, poolTokens, token, amounts[i], to, depositToUserBalance);
        }
    }

    function _removeLiquidity(bytes32 poolId, EnumerableSet.AddressSet storage poolTokens, IERC20 token, uint128 amount, address to, bool depositToUserBalance) internal {
        if (depositToUserBalance) {
            // Deposit tokens to the recipient's User Balance - the Vault's balance doesn't change
            _userTokenBalance[to][token] = _userTokenBalance[to][token].add128(amount);
        } else {
            // Actually transfer the tokens to the recipient
            _pushTokens(token, to, amount, true);
        }

        bytes32 newBalance = _poolTokenBalance[poolId][token].decreaseCash(amount);
        _poolTokenBalance[poolId][token] = newBalance;

        if (newBalance.isZero()) {
            poolTokens.remove(address(token));
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
        require(missing || _poolTokenBalance[poolId][token].isNotInvested(), "CANNOT_SET_INVESTMENT_MANAGER");

        _poolInvestmentManagers[poolId][token] = manager;
        emit AuthorizedPoolInvestmentManager(poolId, token, manager);
    }

    function revokePoolInvestmentManager(bytes32 poolId, IERC20 token) external override onlyPoolController(poolId) {
        address currentManager = _poolInvestmentManagers[poolId][token];
        bool exists = currentManager != address(0);
        require(exists && _poolTokenBalance[poolId][token].isNotInvested(), "CANNOT_REVOKE_INVESTMENT_MANAGER");

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
        _poolTokenBalance[poolId][token] = _poolTokenBalance[poolId][token].cashToInvested(amount);
        _pushTokens(token, msg.sender, amount, false);
    }

    function divestPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token) {
        // TODO: Think about what happens with tokens that charge a transfer fee
        uint128 divestedAmount = _pullTokens(token, msg.sender, amount);
        _poolTokenBalance[poolId][token] = _poolTokenBalance[poolId][token].investedToCash(divestedAmount);
    }

    function updateInvested(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token) {
        _poolTokenBalance[poolId][token] = _poolTokenBalance[poolId][token].setInvested(amount);
    }

    function _isPoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address account
    ) internal view returns (bool) {
        return _poolInvestmentManagers[poolId][token] == account;
    }
}
