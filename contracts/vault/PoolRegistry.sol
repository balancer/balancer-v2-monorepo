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

    // Tokens in a pool have non-zero balances, which can be used as a shortcut to check
    // at once if a) a pool exists and b) a token is in that pool.

    // Data for pools with Pair Trading Strategies

    mapping(bytes32 => EnumerableSet.AddressSet) internal _poolPairTokens;
    mapping(bytes32 => mapping(IERC20 => bytes32)) internal _poolPairTokenBalance;

    // Data for pools with Tuple Trading Strategies

    mapping(bytes32 => mapping(uint256 => bytes32)) internal _poolTupleTokenBalance;
    mapping(bytes32 => mapping(IERC20 => uint256)) internal _poolTupleTokenIndex;

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
        IERC20[] memory tokens = new IERC20[](_poolPairTokens[poolId].length());

        for (uint256 i = 0; i < tokens.length; ++i) {
            tokens[i] = IERC20(_poolPairTokens[poolId].at(i));
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
            balances[i] = _getPoolTokenBalance(poolId, tokens[i]).total();
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
            if (amounts[i] > 0) {
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

                bytes32 currentBalance = _getPoolTokenBalance(poolId, tokens[i]);
                if (currentBalance.total() == 0) {
                    // No tokens with zero balance should ever be in the _poolPairTokens set
                    assert(_poolPairTokens[poolId].add(address(tokens[i])));
                }

                _setPoolTokenBalance(poolId, tokens[i], currentBalance.increaseCash(amounts[i]));
            }
        }
    }

    function _getPoolTokenBalance(bytes32 poolId, IERC20 token) internal view returns (bytes32) {
        (, StrategyType strategyType) = fromPoolId(poolId);

        if (strategyType == StrategyType.PAIR) {
            return _poolPairTokenBalance[poolId][token];
        } else {
            uint256 tokenIndex = _poolTupleTokenIndex[poolId][token];
            return _poolTupleTokenBalance[poolId][tokenIndex];
        }
    }

    function _setPoolTokenBalance(
        bytes32 poolId,
        IERC20 token,
        bytes32 balance
    ) internal {
        (, StrategyType strategyType) = fromPoolId(poolId);

        if (strategyType == StrategyType.PAIR) {
            _poolPairTokenBalance[poolId][token] = balance;
        } else {
            uint256 tokenIndex = _poolTupleTokenIndex[poolId][token];
            _poolTupleTokenBalance[poolId][tokenIndex] = balance;
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
            require(_poolPairTokens[poolId].contains(address(tokens[i])), "Token not in pool");

            if (depositToUserBalance) {
                // Deposit tokens to the recipient's User Balance - the Vault's balance doesn't change
                _userTokenBalance[to][tokens[i]] = _userTokenBalance[to][tokens[i]].add128(amounts[i]);
            } else {
                // Actually transfer the tokens to the recipient
                _pushTokens(tokens[i], to, amounts[i], true);
            }

            _poolPairTokenBalance[poolId][tokens[i]] = _poolPairTokenBalance[poolId][tokens[i]].decreaseCash(
                amounts[i]
            );

            if (_poolPairTokenBalance[poolId][tokens[i]].total() == 0) {
                _poolPairTokens[poolId].remove(address(tokens[i]));
            }
        }
    }

    function getInvestablePercentage(bytes32 poolId, IERC20 token)
        external
        view
        override
        withExistingPool(poolId)
        returns (uint128)
    {
        return _investablePercentage[poolId][token];
    }

    function setInvestablePercentage(
        bytes32 poolId,
        IERC20 token,
        uint128 percentage
    ) external override nonReentrant withExistingPool(poolId) onlyPoolController(poolId) {
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
                _poolPairTokenBalance[poolId][token].cash() == _poolPairTokenBalance[poolId][token].total(),
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
                _poolPairTokenBalance[poolId][token].cash() == _poolPairTokenBalance[poolId][token].total(),
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
        uint128 targetInvestableAmount = _poolPairTokenBalance[poolId][token].total().mul128(targetUtilization);

        uint128 investedAmount = _poolPairTokenBalance[poolId][token].invested();

        require(
            investedAmount.add128(amountToInvest) <= targetInvestableAmount,
            "over investment amount - cannot invest"
        );

        _poolPairTokenBalance[poolId][token] = _poolPairTokenBalance[poolId][token].cashToInvested(amountToInvest);

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
        uint128 targetInvestableAmount = _poolPairTokenBalance[poolId][token].total().mul128(targetUtilization);
        uint128 investedAmount = _poolPairTokenBalance[poolId][token].invested();

        require(
            investedAmount.sub128(amountToDivest) >= targetInvestableAmount,
            "under investment amount - cannot divest"
        );

        _poolPairTokenBalance[poolId][token] = _poolPairTokenBalance[poolId][token].investedToCash(amountToDivest);

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

        uint128 targetInvestableAmount = _poolPairTokenBalance[poolId][token].total().mul128(targetUtilization);
        uint128 investedAmount = _poolPairTokenBalance[poolId][token].invested();

        if (targetInvestableAmount > investedAmount) {
            uint128 amountToInvest = targetInvestableAmount.sub128(investedAmount);
            _poolPairTokenBalance[poolId][token] = _poolPairTokenBalance[poolId][token].cashToInvested(amountToInvest);

            _pushTokens(token, investmentManager, amountToInvest, false);
            IInvestmentManager(investmentManager).recordPoolInvestment(poolId, amountToInvest);
        } else if (targetInvestableAmount < investedAmount) {
            uint128 amountToDivest = investedAmount.sub128(targetInvestableAmount);

            _poolPairTokenBalance[poolId][token] = _poolPairTokenBalance[poolId][token].investedToCash(amountToDivest);

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
        _poolPairTokenBalance[poolId][token] = _poolPairTokenBalance[poolId][token].setInvested(amountInvested);
    }
}
