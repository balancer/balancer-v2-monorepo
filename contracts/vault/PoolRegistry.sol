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
import "./VaultAccounting.sol";
import "./UserBalance.sol";

import "./balances/CashInvested.sol";
import "./balances/TuplePoolsBalance.sol";
import "./balances/PairPoolsBalance.sol";
import "./balances/TwoTokenPoolsBalance.sol";

abstract contract PoolRegistry is
    ReentrancyGuard,
    IVault,
    VaultAccounting,
    UserBalance,
    TuplePoolsBalance,
    PairPoolsBalance,
    TwoTokenPoolsBalance
{
    using EnumerableSet for EnumerableSet.BytesSet;
    using CashInvested for bytes32;
    using FixedPoint for uint128;

    struct PoolStrategy {
        address strategy;
        StrategyType strategyType;
    }

    // Set with all pools in the system
    // TODO do we need this? can pools be deleted? if not, an array should be good enough
    EnumerableSet.BytesSet internal _pools;

    modifier withExistingPool(bytes32 poolId) {
        require(_pools.contains(poolId), "Inexistent pool");
        _;
    }

    // operators are allowed to use a pools tokens for an investment
    mapping(bytes32 => mapping(IERC20 => address)) private _poolInvestmentManagers;

    event AuthorizedPoolInvestmentManager(bytes32 indexed poolId, IERC20 indexed token, address indexed operator);
    event RevokedPoolInvestmentManager(bytes32 indexed poolId, IERC20 indexed token, address indexed operator);

    modifier onlyPool(bytes32 poolId) {
        (address pool, ) = fromPoolId(poolId);
        require(pool == msg.sender, "Caller is not the pool");
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

    // TODO: consider making the pool address msg.sender, and potentially disallowing the same address to be used
    // multiple times
    function newPool(address strategy, StrategyType strategyType) external override returns (bytes32) {
        bytes32 poolId = toPoolId(strategy, uint16(strategyType), uint32(_pools.length()));

        require(!_pools.contains(poolId), "Pool ID already exists");
        require(strategy != address(0), "Strategy must be set");

        _pools.add(poolId);

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

        if (strategyType == IVault.StrategyType.PAIR) {
            return _getPairPoolTokens(poolId);
        } else if (strategyType == IVault.StrategyType.TWO_TOKEN) {
            return _getTwoTokenPoolTokens(poolId);
        } else {
            return _getTuplePoolTokens(poolId);
        }
    }

    /**
     * @dev Returns the balance for a token in a Pool.
     *
     * Requirements:
     *
     * - `token` must be in the Pool.
     */
    function _getPoolTokenBalance(
        bytes32 poolId,
        IVault.StrategyType strategyType,
        IERC20 token
    ) internal view returns (bytes32) {
        if (strategyType == IVault.StrategyType.PAIR) {
            return _getPairPoolTokenBalance(poolId, token);
        } else if (strategyType == IVault.StrategyType.TWO_TOKEN) {
            return _getTwoTokenPoolBalance(poolId, token);
        } else {
            return _getTuplePoolBalance(poolId, token);
        }
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

    function getPool(bytes32 poolId) external view override withExistingPool(poolId) returns (address, StrategyType) {
        return fromPoolId(poolId);
    }

    function addLiquidity(
        bytes32 poolId,
        address from,
        IERC20[] calldata tokens,
        uint128[] calldata amounts,
        bool withdrawFromUserBalance
    ) external override withExistingPool(poolId) onlyPool(poolId) {
        require(tokens.length == amounts.length, "Tokens and total amounts length mismatch");

        require(isOperatorFor(from, msg.sender), "Caller is not operator");

        // Receive all tokens

        for (uint256 i = 0; i < tokens.length; ++i) {
            // Not technically necessary since the transfer call would fail
            require(tokens[i] != IERC20(0), "Token is the zero address");

            if (amounts[i] > 0) {
                uint128 toReceive = amounts[i];
                if (withdrawFromUserBalance) {
                    uint128 toWithdraw = uint128(Math.min(_userTokenBalance[from][tokens[i]], toReceive));

                    _userTokenBalance[from][tokens[i]] -= toWithdraw;
                    toReceive -= toWithdraw;
                }

                uint128 received = _pullTokens(tokens[i], from, toReceive);
                require(received == toReceive, "Not enough tokens received");
            }
        }

        // Grant tokens to pools - how this is done depends on the pool type

        (, StrategyType strategyType) = fromPoolId(poolId);
        if (strategyType == StrategyType.TWO_TOKEN) {
            // These set both tokens at once
            require(tokens.length == 2, "Must interact with all tokens in two token pool");
            _increaseTwoTokenPoolCash(poolId, tokens[0], amounts[0], tokens[1], amounts[1]);
        } else {
            // Other pool types have their tokens added one by one
            for (uint256 i = 0; i < tokens.length; ++i) {
                if (strategyType == StrategyType.PAIR) {
                    _increasePairPoolCash(poolId, tokens[i], amounts[i]);
                } else {
                    _increaseTuplePoolCash(poolId, tokens[i], amounts[i]);
                }
            }
        }
    }

    function removeLiquidity(
        bytes32 poolId,
        address to,
        IERC20[] calldata tokens,
        uint128[] calldata amounts,
        bool depositToUserBalance
    ) external override withExistingPool(poolId) onlyPool(poolId) {
        require(tokens.length == amounts.length, "Tokens and total amounts length mismatch");

        // Deduct tokens from pools - how this is done depends on the pool type

        (, StrategyType strategyType) = fromPoolId(poolId);
        if (strategyType == StrategyType.TWO_TOKEN) {
            // These set both tokens at once
            require(tokens.length == 2, "Must interact with all tokens in two token pool");
            _decreaseTwoTokenPoolCash(poolId, tokens[0], amounts[0], tokens[1], amounts[1]);
        } else {
            // Other pool types have their tokens added one by one
            for (uint256 i = 0; i < tokens.length; ++i) {
                if (strategyType == StrategyType.PAIR) {
                    _decreasePairPoolCash(poolId, tokens[i], amounts[i]);
                } else {
                    _decreaseTuplePoolCash(poolId, tokens[i], amounts[i]);
                }
            }
        }

        // Send all tokens

        for (uint256 i = 0; i < tokens.length; ++i) {
            // Not technically necessary since the transfer call would fail
            require(tokens[i] != IERC20(0), "Token is the zero address");

            if (amounts[i] > 0) {
                if (depositToUserBalance) {
                    // Deposit tokens to the recipient's User Balance - the Vault's balance doesn't change
                    _userTokenBalance[to][tokens[i]] = _userTokenBalance[to][tokens[i]].add128(amounts[i]);
                } else {
                    // Actually transfer the tokens to the recipient
                    _pushTokens(tokens[i], to, amounts[i], true);
                }
            }
        }
    }

    // Investments

    modifier onlyPoolInvestmentManager(bytes32 poolId, IERC20 token) {
        require(_isPoolInvestmentManager(poolId, token, msg.sender), "SENDER_NOT_INVESTMENT_MANAGER");
        _;
    }

    function _isPoolInvested(
        bytes32 poolId,
        IVault.StrategyType strategyType,
        IERC20 token
    ) internal view returns (bool) {
        if (strategyType == IVault.StrategyType.PAIR) {
            return _isPairPoolInvested(poolId, token);
        } else {
            return _isTuplePoolInvested(poolId, token);
        }
    }

    function authorizePoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address manager
    ) external override onlyPool(poolId) {
        bool missing = _poolInvestmentManagers[poolId][token] == address(0);
        (, StrategyType strategyType) = fromPoolId(poolId);
        require(missing || _isPoolInvested(poolId, strategyType, token), "CANNOT_SET_INVESTMENT_MANAGER");

        _poolInvestmentManagers[poolId][token] = manager;
        emit AuthorizedPoolInvestmentManager(poolId, token, manager);
    }

    function revokePoolInvestmentManager(bytes32 poolId, IERC20 token) external override onlyPool(poolId) {
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
        if (strategyType == IVault.StrategyType.PAIR) {
            _investPairPoolCash(poolId, token, amount);
        } else {
            _investTuplePoolCash(poolId, token, amount);
        }

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
        if (strategyType == IVault.StrategyType.PAIR) {
            _divestPairPoolCash(poolId, token, divestedAmount);
        } else {
            _divestTuplePoolCash(poolId, token, divestedAmount);
        }
    }

    function updateInvested(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token) {
        (, StrategyType strategyType) = fromPoolId(poolId);
        if (strategyType == IVault.StrategyType.PAIR) {
            _setPairPoolInvestment(poolId, token, amount);
        } else {
            _setTuplePoolInvestment(poolId, token, amount);
        }
    }

    function _isPoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address account
    ) internal view returns (bool) {
        return _poolInvestmentManagers[poolId][token] == account;
    }
}
