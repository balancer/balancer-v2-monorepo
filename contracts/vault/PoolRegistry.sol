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
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./UserBalance.sol";

import "./balances/CashInvested.sol";
import "./balances/StandardPoolsBalance.sol";
import "./balances/SimplifiedQuotePoolsBalance.sol";
import "./balances/TwoTokenPoolsBalance.sol";

abstract contract PoolRegistry is
    ReentrancyGuard,
    UserBalance,
    StandardPoolsBalance,
    SimplifiedQuotePoolsBalance,
    TwoTokenPoolsBalance
{
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using SafeERC20 for IERC20;
    using CashInvested for bytes32;
    using FixedPoint for uint128;
    using FixedPoint for uint256;

    // Set with all pools in the system
    // TODO do we need this? can pools be deleted? if not, an array should be good enough
    EnumerableSet.Bytes32Set internal _pools;

    modifier withExistingPool(bytes32 poolId) {
        require(_pools.contains(poolId), "Nonexistent pool");
        _;
    }

    // investment managers are allowed to use a pools tokens for an investment
    mapping(bytes32 => mapping(IERC20 => address)) private _poolInvestmentManagers;

    event PoolInvestmentManagerAdded(bytes32 indexed poolId, IERC20 indexed token, address indexed agent);
    event PoolInvestmentManagerRemoved(bytes32 indexed poolId, IERC20 indexed token, address indexed agent);

    modifier onlyPool(bytes32 poolId) {
        (address pool, ) = fromPoolId(poolId);
        require(pool == msg.sender, "Caller is not the pool");
        _;
    }

    function toPoolId(
        address pool,
        uint16 optimization,
        uint32 poolIndex
    ) public pure returns (bytes32) {
        uint256 serialized;
        serialized |= uint256(poolIndex) << (22 * 8);
        serialized |= uint256(optimization) << (20 * 8);
        serialized |= uint256(pool);
        return bytes32(serialized);
    }

    function fromPoolId(bytes32 serialized) public pure returns (address, PoolOptimization) {
        //|| 6 bytes empty | 4 bytes count of pools | 2 bytes optimization | 20 bytes pool ||
        address pool = address(uint256(serialized) & (2**(20 * 8) - 1));
        PoolOptimization optimization = PoolOptimization(uint256(serialized >> (20 * 8)) & (2**(2 * 8) - 1));

        return (pool, optimization);
    }

    // TODO: consider disallowing the same address to be used multiple times
    function registerPool(PoolOptimization optimization) external override returns (bytes32) {
        bytes32 poolId = toPoolId(msg.sender, uint16(optimization), uint32(_pools.length()));

        bool added = _pools.add(poolId);
        require(added, "Pool ID already exists");

        emit PoolCreated(poolId);

        return poolId;
    }

    function getNumberOfPools() external view override returns (uint256) {
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
        (, PoolOptimization optimization) = fromPoolId(poolId);

        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            return _getSimplifiedQuotePoolTokens(poolId);
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            return _getTwoTokenPoolTokens(poolId);
        } else {
            return _getStandardPoolTokens(poolId);
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
        PoolOptimization optimization,
        IERC20 token
    ) internal view returns (bytes32) {
        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            return _getSimplifiedQuotePoolTokenBalance(poolId, token);
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            return _getTwoTokenPoolBalance(poolId, token);
        } else {
            return _getStandardPoolBalance(poolId, token);
        }
    }

    function getPoolTokenBalances(bytes32 poolId, IERC20[] calldata tokens)
        external
        view
        override
        withExistingPool(poolId)
        returns (uint128[] memory)
    {
        (, PoolOptimization optimization) = fromPoolId(poolId);

        uint128[] memory balances = new uint128[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            balances[i] = _getPoolTokenBalance(poolId, optimization, tokens[i]).total();
        }

        return balances;
    }

    function getPool(bytes32 poolId)
        external
        view
        override
        withExistingPool(poolId)
        returns (address, PoolOptimization)
    {
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

        require(isAgentFor(from, msg.sender), "Caller is not an agent");

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

                tokens[i].safeTransferFrom(from, address(this), toReceive);
            }
        }

        // Grant tokens to pools - how this is done depends on the Pool optimization setting

        (, PoolOptimization optimization) = fromPoolId(poolId);
        if (optimization == PoolOptimization.TWO_TOKEN) {
            // These add both tokens at once
            require(tokens.length == 2, "Must interact with all tokens in two token pool");
            _increaseTwoTokenPoolCash(poolId, tokens[0], amounts[0], tokens[1], amounts[1]);
        } else {
            // Pools with other optimization settings have their tokens added one by one
            for (uint256 i = 0; i < tokens.length; ++i) {
                if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
                    _increaseSimplifiedQuotePoolCash(poolId, tokens[i], amounts[i]);
                } else {
                    _increaseStandardPoolCash(poolId, tokens[i], amounts[i]);
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

        // Grant tokens to pools - how this is done depends on the Pool optimization setting

        (, PoolOptimization optimization) = fromPoolId(poolId);
        if (optimization == PoolOptimization.TWO_TOKEN) {
            // These remove both tokens at once
            require(tokens.length == 2, "Must interact with all tokens in two token pool");
            _decreaseTwoTokenPoolCash(poolId, tokens[0], amounts[0], tokens[1], amounts[1]);
        } else {
            // Pools with other optimization settings have their tokens removed one by one
            for (uint256 i = 0; i < tokens.length; ++i) {
                if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
                    _decreaseSimplifiedQuotePoolCash(poolId, tokens[i], amounts[i]);
                } else {
                    _decreaseStandardPoolCash(poolId, tokens[i], amounts[i]);
                }
            }
        }

        // Send all tokens

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            // Not technically necessary since the transfer call would fail
            require(token != IERC20(0), "Token is the zero address");

            if (amounts[i] > 0) {
                if (depositToUserBalance) {
                    // Deposit tokens to the recipient's User Balance - the Vault's balance doesn't change
                    _userTokenBalance[to][token] = _userTokenBalance[to][token].add128(amounts[i]);
                } else {
                    // Transfer the tokens to the recipient, charging the protocol exit fee
                    uint128 feeAmount = _calculateProtocolWithdrawFeeAmount(amounts[i]);

                    _collectedProtocolFees[token] = _collectedProtocolFees[token].add(feeAmount);
                    token.safeTransfer(to, amounts[i].sub128(feeAmount));
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
        PoolOptimization optimization,
        IERC20 token
    ) internal view returns (bool) {
        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            return _isSimplifiedQuotePoolInvested(poolId, token);
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            return _isTwoTokenPoolInvested(poolId, token);
        } else {
            return _isStandardPoolInvested(poolId, token);
        }
    }

    function authorizePoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address manager
    ) external override onlyPool(poolId) {
        bool missing = _poolInvestmentManagers[poolId][token] == address(0);
        (, PoolOptimization optimization) = fromPoolId(poolId);
        require(missing || _isPoolInvested(poolId, optimization, token), "CANNOT_SET_INVESTMENT_MANAGER");

        _poolInvestmentManagers[poolId][token] = manager;
        emit PoolInvestmentManagerAdded(poolId, token, manager);
    }

    function revokePoolInvestmentManager(bytes32 poolId, IERC20 token) external override onlyPool(poolId) {
        address currentManager = _poolInvestmentManagers[poolId][token];
        bool exists = currentManager != address(0);
        (, PoolOptimization optimization) = fromPoolId(poolId);
        require(exists && _isPoolInvested(poolId, optimization, token), "CANNOT_REVOKE_INVESTMENT_MANAGER");

        delete _poolInvestmentManagers[poolId][token];
        emit PoolInvestmentManagerRemoved(poolId, token, currentManager);
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
        (, PoolOptimization optimization) = fromPoolId(poolId);
        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _investSimplifiedQuotePoolCash(poolId, token, amount);
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            _investTwoTokenPoolCash(poolId, token, amount);
        } else {
            _investStandardPoolCash(poolId, token, amount);
        }

        token.safeTransfer(msg.sender, amount);
    }

    function divestPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token) {
        token.safeTransferFrom(msg.sender, address(this), amount);

        (, PoolOptimization optimization) = fromPoolId(poolId);
        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _divestSimplifiedQuotePoolCash(poolId, token, amount);
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            _divestTwoTokenPoolCash(poolId, token, amount);
        } else {
            _divestStandardPoolCash(poolId, token, amount);
        }
    }

    function updateInvested(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token) {
        (, PoolOptimization optimization) = fromPoolId(poolId);
        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _setSimplifiedQuotePoolInvestment(poolId, token, amount);
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            _setTwoTokenPoolInvestment(poolId, token, amount);
        } else {
            _setStandardPoolInvestment(poolId, token, amount);
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
