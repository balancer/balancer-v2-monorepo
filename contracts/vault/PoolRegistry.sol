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
import "../investmentManagers/IInvestmentManager.sol";

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
        require(tokens.length == amounts.length, "Tokens and total amounts length mismatch");

        require(isOperatorFor(from, msg.sender), "Caller is not operator");

        for (uint256 i = 0; i < tokens.length; ++i) {
            {
                // scope for toReceive and received - avoids 'stack too deep' error
                uint128 toReceive = amounts[i];
                if (withdrawFromUserBalance) {
                    uint128 toWithdraw = uint128(Math.min(_userTokenBalance[from][tokens[i]], toReceive));

                    _userTokenBalance[from][tokens[i]] -= toWithdraw;
                    toReceive -= toWithdraw;
                }

                uint128 received = _pullTokens(tokens[i], from, toReceive);
                require(received == toReceive, "Not enough tokens received");
            }
            if (amounts[i] > 0) {
                bytes32 currentBalance = _poolTokenBalance[poolId][tokens[i]];
                if (currentBalance.total() == 0) {
                    // No tokens with zero balance should ever be in the _poolTokens set
                    assert(_poolTokens[poolId].add(address(tokens[i])));
                }

                _poolTokenBalance[poolId][tokens[i]] = _poolTokenBalance[poolId][tokens[i]].increaseCash(amounts[i]);
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

        for (uint256 i = 0; i < tokens.length; ++i) {
            require(_poolTokens[poolId].contains(address(tokens[i])), "Token not in pool");

            if (depositToUserBalance) {
                // Deposit tokens to the recipient's User Balance - the Vault's balance doesn't change
                _userTokenBalance[to][tokens[i]] = _userTokenBalance[to][tokens[i]].add128(amounts[i]);
            } else {
                // Actually transfer the tokens to the recipient
                _pushTokens(tokens[i], to, amounts[i], true);
            }

            _poolTokenBalance[poolId][tokens[i]] = _poolTokenBalance[poolId][tokens[i]].decreaseCash(amounts[i]);

            if (_poolTokenBalance[poolId][tokens[i]].total() == 0) {
                _poolTokens[poolId].remove(address(tokens[i]));
            }
        }
    }

    function authorizePoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address operator
    ) external override onlyPoolController(poolId) {
        require(
            _poolInvestmentManagers[poolId][token] == address(0) ||
                _poolTokenBalance[poolId][token].cash() == _poolTokenBalance[poolId][token].total(),
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
                _poolTokenBalance[poolId][token].cash() == _poolTokenBalance[poolId][token].total(),
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
        require(isPoolInvestmentManager(poolId, token, operator), "SENDER_NOT_INVESTMENT_MANAGER");
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

    function investPoolBalance(
        bytes32 poolId,
        IERC20 token,
        address investmentManager,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token, investmentManager) {
        _poolTokenBalance[poolId][token] = _poolTokenBalance[poolId][token].cashToInvested(amount);
        _pushTokens(token, investmentManager, amount, false);
        IInvestmentManager(investmentManager).recordPoolInvestment(poolId, amount);
    }

    function divestPoolBalance(
        bytes32 poolId,
        IERC20 token,
        address investmentManager,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token, investmentManager) {
        // TODO: Think about what happens with tokens that charge a transfer fee
        _poolTokenBalance[poolId][token] = _poolTokenBalance[poolId][token].investedToCash(amount);
        _pullTokens(token, investmentManager, amount);
        IInvestmentManager(investmentManager).recordPoolDivestment(poolId, amount);
    }

    function updateInvested(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token, msg.sender) {
        bytes32 previousBalance = _poolTokenBalance[poolId][token];
        uint128 previousInvestedAmount = previousBalance.invested();
        bytes32 currentBalance = previousBalance.setInvested(amount);
        uint128 currentInvestedAmount = currentBalance.invested();
        _poolTokenBalance[poolId][token] = currentBalance;

        if (currentInvestedAmount > previousInvestedAmount) {
            // No need for SafeMath: It was checked right above as part of the 'if' statement condition
            uint128 amountToInvest = currentInvestedAmount - previousInvestedAmount;
            _pushTokens(token, msg.sender, amountToInvest, false);
            IInvestmentManager(msg.sender).recordPoolInvestment(poolId, amountToInvest);
        } else if (currentInvestedAmount < previousInvestedAmount) {
            // TODO: think about what happens with tokens that charge a transfer fee
            // No need for SafeMath: It was checked right above as part of the 'else if' statement condition
            uint128 amountToDivest = previousInvestedAmount - currentInvestedAmount;
            _pullTokens(token, msg.sender, amountToDivest);
            IInvestmentManager(msg.sender).recordPoolDivestment(poolId, amountToDivest);
        } else {
            revert("INVESTMENT_ALREADY_UP_TO_DATE");
        }
    }
}
