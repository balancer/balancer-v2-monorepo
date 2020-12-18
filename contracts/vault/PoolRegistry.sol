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

// Needed for struct arguments
pragma experimental ABIEncoderV2;

// Imports

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../vendor/EnumerableSet.sol";
import "./CashInvestedBalance.sol";
import "./PoolBalance.sol";
import "./UserBalance.sol";

// Contracts

/**
 * @title Record and manage all pools in the system
 * @author Balancer Labs
 */
abstract contract PoolRegistry is ReentrancyGuard, UserBalance, PoolBalance {
    using EnumerableSet for EnumerableSet.BytesSet;
    using CashInvestedBalance for bytes32;
    using FixedPoint for uint128;

    // Type declarations

    struct PoolStrategy {
        address strategy;
        StrategyType strategyType;
    }

    // State variables

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

    // agents are allowed to use a pool's tokens for an investment
    mapping(bytes32 => mapping(IERC20 => address)) private _poolInvestmentManagers;

    // Event declarations

    event AuthorizedPoolInvestmentManager(bytes32 indexed poolId, IERC20 indexed token, address indexed agent);
    event RevokedPoolInvestmentManager(bytes32 indexed poolId, IERC20 indexed token, address indexed agent);

    // Modifiers

    modifier withExistingPool(bytes32 poolId) {
        require(_pools.contains(poolId), "Nonexistent pool");
        _;
    }

    modifier onlyPoolController(bytes32 poolId) {
        require(_poolController[poolId] == msg.sender, "Caller is not the pool controller");
        _;
    }

    modifier onlyPoolInvestmentManager(bytes32 poolId, IERC20 token) {
        require(_isPoolInvestmentManager(poolId, token, msg.sender), "SENDER_NOT_INVESTMENT_MANAGER");
        _;
    }

    // Function declarations

    // External functions

    /**
     * @notice Create a new pool
     * @dev Use `fromPoolId` and `toPoolId` to encode/decode the pool ID
     *      Emits a PoolCreated event
     * @param strategy - address of the pool contract
     * @param strategyType - pool type
     * @return encoded pool ID
     */
    function newPool(
        address strategy,
        StrategyType strategyType
    )
        external
        override
        returns (bytes32)
    {
        bytes32 poolId = toPoolId(strategy, uint16(strategyType), uint32(_pools.length()));

        require(!_pools.contains(poolId), "Pool ID already exists");
        require(strategy != address(0), "Strategy must be set");

        _pools.add(poolId);
        _poolController[poolId] = msg.sender;

        emit PoolCreated(poolId);

        return poolId;
    }

    /**
     * @notice Get the total number of pools
     * @return the number of pools
     */
    function getNumberOfPools() external view override returns (uint256) {
        return _pools.length();
    }

    /**
     * @notice Returns a partial list of pools as a 0-based, exclusive range [start, end)
     * @param start - 0-based index into the list
     * @param end - ending index (exclusive)
     */
    function getPoolIds(
        uint256 start,
        uint256 end
    )
        external
        view
        override
        returns (bytes32[] memory)
    {
        require((end >= start) && (end - start) <= _pools.length(), "Bad indices");

        bytes32[] memory poolIds = new bytes32[](end - start);
        for (uint256 i = 0; i < poolIds.length; ++i) {
            poolIds[i] = _pools.at(i + start);
        }

        return poolIds;
    }

    /**
     * @notice Returns the list of tokens for a given pool
     * @param poolId - the encoded pool ID
     * @return list of token addresses
     */
    function getPoolTokens(bytes32 poolId)
        external
        view
        override
        withExistingPool(poolId)
        returns (IERC20[] memory)
    {
        (, StrategyType strategyType) = fromPoolId(poolId);

        return _getPoolTokens(poolId, strategyType);
    }

    /**
     * @notice Returns the token balances in a given pool
     * @param poolId - the encoded pool ID
     * @param tokens - the list of tokens for which we want balances
     * @return list of balances (parallel to the token list)
     */
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

    /**
     * @notice Returns the pool contract
     * @param poolId - the encoded pool ID
     * @return the address of the pool contract
     */
    function getPoolController(bytes32 poolId)
        external
        view
        override
        withExistingPool(poolId)
        returns (address)
    {
        return _poolController[poolId];
    }

    /**
     * @notice Returns the pool (and its type)
     * @param poolId - the encoded pool ID
     * @return the pool contract address and type
     */
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

    /**
     * @notice Set the pool controller
     * @param poolId - the encoded pool ID
     * @param controller - new pool controller address
     */
    function setPoolController(bytes32 poolId, address controller)
        external
        override
        nonReentrant
        withExistingPool(poolId)
        onlyPoolController(poolId)
    {
        _poolController[poolId] = controller;
    }

    /**
     * @notice Add liquidity to a pool
     * @dev The caller must be an agent for "from"
     * @param poolId - the encoded pool ID
     * @param from - address we're pulling the tokens from
     * @param tokens - the tokens we're depositing
     * @param amounts - the amounts we're depositing
     * @param withdrawFromUserBalance - flag indicating whether to pull from User Balance first
     *                                  (any remainder will be drawn from the "from" address)
     */
    function addLiquidity(
        bytes32 poolId,
        address from,
        IERC20[] calldata tokens,
        uint128[] calldata amounts,
        bool withdrawFromUserBalance
    )
        external
        override
        withExistingPool(poolId)
        onlyPoolController(poolId)
    {
        require(tokens.length == amounts.length, "Tokens and total amounts length mismatch");
        require(isAgentFor(from, msg.sender), "Caller is not agent");

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

    /**
     * @notice Remove liquidity from a pool
     * @param poolId - the encoded pool ID
     * @param to - address we're sending the tokens to
     * @param tokens - the tokens we're depositing
     * @param amounts - the amounts we're depositing
     * @param depositToUserBalance - flag indicating whether to add to User Balance
     *                               (otherwise, funds will be forwarded to the "to" address)
     */
    function removeLiquidity(
        bytes32 poolId,
        address to,
        IERC20[] calldata tokens,
        uint128[] calldata amounts,
        bool depositToUserBalance
    )
        external
        override
        withExistingPool(poolId)
        onlyPoolController(poolId)
    {
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

    /**
     * @notice Add a pool asset manager for a token
     * @dev The asset manager cannot be changed if there are funds under management
     * @param poolId - the encoded pool ID
     * @param token - the token we're placing under management
     * @param manager - the asset manager in charge of this token
     */
    function authorizePoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address manager
    )
        external
        override
        onlyPoolController(poolId)
    {
        bool missing = _poolInvestmentManagers[poolId][token] == address(0);
        (, StrategyType strategyType) = fromPoolId(poolId);
        require(missing || _isPoolInvested(poolId, strategyType, token), "CANNOT_SET_INVESTMENT_MANAGER");

        _poolInvestmentManagers[poolId][token] = manager;
        emit AuthorizedPoolInvestmentManager(poolId, token, manager);
    }

    /**
     * @notice Remove a pool asset manager for a token
     * @dev The asset manager cannot be removed unless there are funds under management
     * @param poolId - the encoded pool ID
     * @param token - the token we're removing from management
     */
    function revokePoolInvestmentManager(
        bytes32 poolId,
        IERC20 token
    )
        external
        override
        onlyPoolController(poolId)
    {
        address currentManager = _poolInvestmentManagers[poolId][token];
        bool exists = currentManager != address(0);
        (, StrategyType strategyType) = fromPoolId(poolId);
        require(exists && _isPoolInvested(poolId, strategyType, token), "CANNOT_REVOKE_INVESTMENT_MANAGER");

        delete _poolInvestmentManagers[poolId][token];
        emit RevokedPoolInvestmentManager(poolId, token, currentManager);
    }

    /**
     * @notice Determine whether an address is the asset manager for a token in a pool
     * @dev delegate to internal function
     * @param poolId - the encoded pool ID
     * @param token - the token we're checking
     * @param account - the potential asset manager
     * @return boolean flag; true if the account is an asset manager
     */
    function isPoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address account
    )
        external
        view
        returns (bool)
    {
        return _isPoolInvestmentManager(poolId, token, account);
    }

    /**
     * @notice Add to the managed balance of a token in a pool
     * @dev Implemented in `PoolBalance`
     *      Each token has cash and managed portions, where cash + managed = total
     *      Increasing the managed balance decreases the cash available
     * @param poolId - the encoded pool ID
     * @param token - the token we're changing the balance of
     * @param amount - the amount we're moving from cash to managed
     */
    function investPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    )
        external
        override
        onlyPoolInvestmentManager(poolId, token)
    {
        (, StrategyType strategyType) = fromPoolId(poolId);
        _investPoolCash(poolId, strategyType, token, amount);

        _pushTokens(token, msg.sender, amount, false);
    }

    /**
     * @notice Remove from the managed balance of a token in a pool
     * @dev Implemented in `PoolBalance`
     *      Each token has cash and managed portions, where cash + managed = total
     *      Decreasing the managed balance increases the cash available
     * @param poolId - the encoded pool ID
     * @param token - the token we're changing the balance of
     * @param amount - the amount we're moving from managed to cash
     */
    function divestPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    )
        external
        override
        onlyPoolInvestmentManager(poolId, token)
    {
        // Tokens that charge a transfer fee are unsupported
        uint128 divestedAmount = _pullTokens(token, msg.sender, amount);

        (, StrategyType strategyType) = fromPoolId(poolId);
        _divestPoolCash(poolId, strategyType, token, divestedAmount);
    }

    /**
     * @notice Directly set the managed balance of a token in a pool
     * @dev Implemented in `PoolBalance`
     *      Each token has cash and managed portions, where cash + managed = total
     *      Setting the managed value directly without changing the cash will alter the total
     *      This is how the asset manager reports gains/losses
     *      (i.e., setting the managed balance to a higher value represents a gain)
     * @param poolId - the encoded pool ID
     * @param token - the token we're changing the balance of
     * @param amount - the amount we're setting the managed balance to
     */
    function updateInvested(
        bytes32 poolId,
        IERC20 token,
        uint128 amount
    ) external override onlyPoolInvestmentManager(poolId, token) {
        (, StrategyType strategyType) = fromPoolId(poolId);
        _setPoolInvestment(poolId, strategyType, token, amount);
    }

    // Public functions

    /**
     * @notice Encode a pool address and type to a Bytes32 "poolId" value
     * @dev Pools are deployed as contracts, then registered with the vault, which holds the assets and performs swaps
     *      (based on logic in the pool contract)
     * @param strategy - the pool contract address
     * @param strategyType - the pool type
     * @param poolIndex - the index of the pool
     * @return the encoded pool ID
     */
    function toPoolId(
        address strategy,
        uint16 strategyType,
        uint32 poolIndex
    )
        public
        pure
        returns (bytes32)
    {
        uint256 serialized;
        serialized |= uint256(poolIndex) << (22 * 8);
        serialized |= uint256(strategyType) << (20 * 8);
        serialized |= uint256(strategy);
        return bytes32(serialized);
    }

    /**
     * @notice Decode a Bytes32 "poolId" into a pool address and type
     * @dev Pools are deployed as contracts, then registered with the vault, which holds the assets and performs swaps
     *      (based on logic in the pool contract)
     * @param poolId - the encoded poolId
     * @return strategy (address) and strategyType of the pool
     */
   function fromPoolId(bytes32 poolId)
        public
        pure
        returns (address strategy, StrategyType strategyType)
    {
        //|| 6 bytes empty | 4 bytes count of pools | 2 bytes strategyType | 20 bytes address ||
        strategy = address(uint256(poolId) & (2**(20 * 8) - 1));
        strategyType = StrategyType(uint256(poolId >> (20 * 8)) & (2**(2 * 8) - 1));
    }

    // Internal functions

    /**
     * @notice Determine whether an address is the asset manager for a token in a pool
     * @dev Could also pass in the ZERO_ADDRESS to check if there is no asset manager assigned
     * @param poolId - the encoded pool ID
     * @param token - the token we're checking
     * @param account - the potential asset manager
     * @return boolean flag; true if the account is an asset manager
     */
    function _isPoolInvestmentManager(
        bytes32 poolId,
        IERC20 token,
        address account
    )
        internal
        view
        returns (bool)
    {
        return _poolInvestmentManagers[poolId][token] == account;
    }
}
