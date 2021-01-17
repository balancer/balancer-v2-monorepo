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
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../vendor/ReentrancyGuard.sol";

import "./InternalBalance.sol";

import "./balances/BalanceAllocation.sol";
import "./balances/StandardPoolsBalance.sol";
import "./balances/SimplifiedQuotePoolsBalance.sol";
import "./balances/TwoTokenPoolsBalance.sol";

abstract contract PoolRegistry is
    ReentrancyGuard,
    InternalBalance,
    StandardPoolsBalance,
    SimplifiedQuotePoolsBalance,
    TwoTokenPoolsBalance
{
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using SafeERC20 for IERC20;
    using BalanceAllocation for bytes32;
    using FixedPoint for uint128;
    using FixedPoint for uint256;
    using SafeCast for uint256;
    using SafeCast for uint128;

    // Set with all pools in the system
    EnumerableSet.Bytes32Set internal _pools;

    modifier withExistingPool(bytes32 poolId) {
        require(_pools.contains(poolId), "Nonexistent pool");
        _;
    }

    mapping(bytes32 => mapping(IERC20 => address)) private _poolAssetManagers;

    event PoolAssetManagerSet(bytes32 indexed poolId, IERC20 indexed token, address indexed agent);

    modifier onlyPool(bytes32 poolId) {
        (address pool, ) = _getPoolData(poolId);
        require(pool == msg.sender, "Caller is not the pool");
        _;
    }

    /**
     * @dev Returns a Pool ID. These are deterministically created, by packing into the ID the Pool address and its
     * optimization setting. In order to make them unique, a nonce is also added.
     *
     * This packing allows for retrieval of a Pool's address and optimization setting without any storage reads, via
     * `_getPoolData`.
     */
    function _toPoolId(
        address pool,
        PoolOptimization optimization,
        uint80 nonce
    ) internal pure returns (bytes32) {
        uint256 serialized;

        // | 10 bytes nonce | 2 bytes optimization setting | 20 bytes pool address |
        serialized |= uint256(nonce) << (22 * 8);
        serialized |= uint256(optimization) << (20 * 8);
        serialized |= uint256(pool);

        return bytes32(serialized);
    }

    /**
     * @dev Returns a Pool's ID and optimization setting. Because of how Pool IDs are created by `_toPoolId`, this is
     * done with no storage accesses.
     */
    function _getPoolData(bytes32 poolId) internal pure returns (address, PoolOptimization) {
        // | 10 bytes nonce | 2 bytes optimization setting | 20 bytes pool address |
        address pool = address(uint256(poolId) & (2**(20 * 8) - 1));
        PoolOptimization optimization = PoolOptimization(uint256(poolId >> (20 * 8)) & (2**(2 * 8) - 1));

        return (pool, optimization);
    }

    function registerPool(PoolOptimization optimization) external override nonReentrant returns (bytes32) {
        // We use the Pool length as the Pool ID creation nonce. Since Pools cannot be deleted, nonces are unique. This
        // however assumes there will never be more than than 2**80 Pools.
        bytes32 poolId = _toPoolId(msg.sender, optimization, uint80(_pools.length()));

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
        (, PoolOptimization optimization) = _getPoolData(poolId);

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
            return _getSimplifiedQuotePoolBalance(poolId, token);
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
        returns (uint256[] memory)
    {
        (, PoolOptimization optimization) = _getPoolData(poolId);

        uint256[] memory balances = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            balances[i] = _getPoolTokenBalance(poolId, optimization, tokens[i]).totalBalance();
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
        return _getPoolData(poolId);
    }

    function registerTokens(bytes32 poolId, IERC20[] calldata tokens, address[] calldata assetManagers)
        external
        override
        nonReentrant
        withExistingPool(poolId)
        onlyPool(poolId)
    {
        (, PoolOptimization optimization) = _getPoolData(poolId);
        if (optimization == PoolOptimization.TWO_TOKEN) {
            require(tokens.length == 2, "ERR_TOKENS_LENGTH_MUST_BE_2");
            _registerTwoTokenPoolTokens(poolId, tokens[0], tokens[1]);
        } else if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _registerSimplifiedQuotePoolTokens(poolId, tokens);
        } else {
            _registerStandardPoolTokens(poolId, tokens);
        }

        // Assign each token's asset manager
        for (uint256 i = 0; i < tokens.length; ++i) {
            address assetManager = assetManagers[i];
            IERC20 token = tokens[i];

            // The zero address means this token is unmanaged
            if (assetManager != address(0)) {
                // Should never have a non-zero asset manager here
                // pool token calls above will revert if the token has already been registered,
                // so we should only get here during pool creation (or adding new tokens)
                // Calling unregister will remove the asset manager, so it should be zero on re-registration
                assert(_poolAssetManagers[poolId][token] == address(0));

                _poolAssetManagers[poolId][token] = assetManager;

                emit PoolAssetManagerSet(poolId, token, assetManager);
            }
        }

        emit TokensRegistered(poolId, tokens);
    }

    function unregisterTokens(bytes32 poolId, IERC20[] calldata tokens)
        external
        override
        nonReentrant
        withExistingPool(poolId)
        onlyPool(poolId)
    {
        (, PoolOptimization optimization) = _getPoolData(poolId);
        if (optimization == PoolOptimization.TWO_TOKEN) {
            require(tokens.length == 2, "ERR_TOKENS_LENGTH_MUST_BE_2");
            _unregisterTwoTokenPoolTokens(poolId, tokens[0], tokens[1]);
        } else if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _unregisterSimplifiedQuotePoolTokens(poolId, tokens);
        } else {
            _unregisterStandardPoolTokens(poolId, tokens);
        }

        // The unregister calls above ensure the token balance is zero
        // So safe to remove any associated asset managers
        for (uint256 i = 0; i < tokens.length; ++i) {
            delete _poolAssetManagers[poolId][tokens[i]];
        }

        emit TokensUnregistered(poolId, tokens);
    }

    function addLiquidity(
        bytes32 poolId,
        address from,
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        bool withdrawFromInternalBalance
    ) external override nonReentrant withExistingPool(poolId) onlyPool(poolId) {
        require(isAgentFor(from, msg.sender), "Caller is not an agent");
        require(tokens.length == amounts.length, "Tokens and total amounts length mismatch");

        // Receive all tokens
        _receiveLiquidity(from, tokens, amounts, withdrawFromInternalBalance);

        // Grant tokens to pools - how this is done depends on the Pool optimization setting
        (, PoolOptimization optimization) = _getPoolData(poolId);
        if (optimization == PoolOptimization.TWO_TOKEN) {
            require(tokens.length == 2, "ERR_TOKENS_LENGTH_MUST_BE_2");
            _increaseTwoTokenPoolCash(poolId, tokens[0], amounts[0].toUint128(), tokens[1], amounts[1].toUint128());
        } else if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _increaseSimplifiedQuotePoolCash(poolId, tokens, amounts);
        } else {
            _increaseStandardPoolCash(poolId, tokens, amounts);
        }
    }

    function _receiveLiquidity(
        address from,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bool withdrawFromInternalBalance
    ) internal {
        for (uint256 i = 0; i < tokens.length; ++i) {
            // Not technically necessary since the transfer call would fail
            IERC20 token = tokens[i];
            require(token != IERC20(0), "Token is the zero address");

            uint256 toReceive = amounts[i];
            if (toReceive > 0) {
                if (withdrawFromInternalBalance) {
                    uint128 toWithdraw = uint128(Math.min(_internalTokenBalance[from][token], toReceive));
                    _internalTokenBalance[from][token] -= toWithdraw;
                    toReceive -= toWithdraw;
                }

                token.safeTransferFrom(from, address(this), toReceive);
            }
        }
    }

    function removeLiquidity(
        bytes32 poolId,
        address to,
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        bool depositToInternalBalance
    ) external override nonReentrant withExistingPool(poolId) onlyPool(poolId) {
        require(tokens.length == amounts.length, "Tokens and total amounts length mismatch");

        // Deduct tokens from pools - how this is done depends on the Pool optimization setting
        (, PoolOptimization optimization) = _getPoolData(poolId);
        if (optimization == PoolOptimization.TWO_TOKEN) {
            require(tokens.length == 2, "ERR_TOKENS_LENGTH_MUST_BE_2");
            _decreaseTwoTokenPoolCash(poolId, tokens[0], amounts[0].toUint128(), tokens[1], amounts[1].toUint128());
        } else if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _decreaseSimplifiedQuotePoolCash(poolId, tokens, amounts);
        } else {
            _decreaseStandardPoolCash(poolId, tokens, amounts);
        }

        // Send all tokens
        _withdrawLiquidity(to, tokens, amounts, depositToInternalBalance);
    }

    function _withdrawLiquidity(
        address to,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bool depositToInternalBalance
    ) internal {
        for (uint256 i = 0; i < tokens.length; ++i) {
            // Not technically necessary since the transfer call would fail
            IERC20 token = tokens[i];
            require(token != IERC20(0), "Token is the zero address");

            uint256 amount256 = amounts[i];
            uint128 amount128 = amount256.toUint128();
            if (amount256 > 0) {
                if (depositToInternalBalance) {
                    // Deposit tokens to the recipient User's Internal Balance - the Vault's balance doesn't change
                    _internalTokenBalance[to][token] = _internalTokenBalance[to][token].add128(amount128);
                } else {
                    // Transfer the tokens to the recipient, charging the protocol exit fee
                    uint128 feeAmount = _calculateProtocolWithdrawFeeAmount(amount128);
                    _collectedProtocolFees[token] = _collectedProtocolFees[token].add(feeAmount);
                    token.safeTransfer(to, amount256.sub(feeAmount));
                }
            }
        }
    }

    // Assets under management

    modifier onlyPoolAssetManager(bytes32 poolId, IERC20 token) {
        require(_isPoolAssetManager(poolId, token, msg.sender), "SENDER_NOT_ASSET_MANAGER");
        _;
    }

    function _poolIsManaged(
        bytes32 poolId,
        PoolOptimization optimization,
        IERC20 token
    ) internal view returns (bool) {
        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            return _simplifiedQuotePoolIsManaged(poolId, token);
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            return _twoTokenPoolIsManaged(poolId, token);
        } else {
            return _standardPoolIsManaged(poolId, token);
        }
    }

    function getPoolAssetManager(bytes32 poolId, IERC20 token) external view override returns (address) {
        return _poolAssetManagers[poolId][token];
    }

    function isPoolAssetManager(
        bytes32 poolId,
        IERC20 token,
        address account
    ) external view returns (bool) {
        return _isPoolAssetManager(poolId, token, account);
    }

    function withdrawPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external override nonReentrant onlyPoolAssetManager(poolId, token) {
        (, PoolOptimization optimization) = _getPoolData(poolId);
        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _simplifiedQuotePoolCashToManaged(poolId, token, amount.toUint128());
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            _twoTokenPoolCashToManaged(poolId, token, amount.toUint128());
        } else {
            _standardPoolCashToManaged(poolId, token, amount.toUint128());
        }

        token.safeTransfer(msg.sender, amount);
    }

    function depositPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external override nonReentrant onlyPoolAssetManager(poolId, token) {
        token.safeTransferFrom(msg.sender, address(this), amount);

        (, PoolOptimization optimization) = _getPoolData(poolId);
        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _simplifiedQuotePoolManagedToCash(poolId, token, amount.toUint128());
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            _twoTokenPoolManagedToCash(poolId, token, amount.toUint128());
        } else {
            _standardPoolManagedToCash(poolId, token, amount.toUint128());
        }
    }

    function updateManagedBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external override nonReentrant onlyPoolAssetManager(poolId, token) {
        (, PoolOptimization optimization) = _getPoolData(poolId);
        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _setSimplifiedQuotePoolManagedBalance(poolId, token, amount.toUint128());
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            _setTwoTokenPoolManagedBalance(poolId, token, amount.toUint128());
        } else {
            _setStandardPoolManagedBalance(poolId, token, amount.toUint128());
        }
    }

    function _isPoolAssetManager(
        bytes32 poolId,
        IERC20 token,
        address account
    ) internal view returns (bool) {
        return _poolAssetManagers[poolId][token] == account;
    }

    function paySwapProtocolFees(
        bytes32 poolId,
        IERC20[] calldata tokens,
        uint256[] calldata collectedFees
    ) external override nonReentrant withExistingPool(poolId) onlyPool(poolId) returns (uint256[] memory balances) {
        require(tokens.length == collectedFees.length, "Tokens and total collected fees length mismatch");

        uint128 swapFee = getProtocolSwapFee().toUint128();
        (, PoolOptimization optimization) = _getPoolData(poolId);

        if (optimization == PoolOptimization.TWO_TOKEN) {
            require(tokens.length == 2, "ERR_TOKENS_LENGTH_MUST_BE_2");

            IERC20 tokenX = tokens[0];
            IERC20 tokenY = tokens[1];
            uint128 feeToCollectTokenX = collectedFees[0].toUint128().mul128(swapFee);
            uint128 feeToCollectTokenY = collectedFees[1].toUint128().mul128(swapFee);

            _decreaseTwoTokenPoolCash(poolId, tokenX, feeToCollectTokenX, tokenY, feeToCollectTokenY);
        } else {
            uint256[] memory feesToCollect = _collectProtocolSwapFees(tokens, collectedFees, swapFee);
            if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
                _decreaseSimplifiedQuotePoolCash(poolId, tokens, feesToCollect);
            } else {
                _decreaseStandardPoolCash(poolId, tokens, feesToCollect);
            }
        }

        balances = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            balances[i] = _getPoolTokenBalance(poolId, optimization, tokens[i]).totalBalance();
        }

        return balances;
    }

    function _collectProtocolSwapFees(
        IERC20[] memory tokens,
        uint256[] memory collectedFees,
        uint256 swapFee
    ) private returns (uint256[] memory feesToCollect) {
        feesToCollect = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            uint256 feeToCollect = collectedFees[i].mul(swapFee);
            _collectedProtocolFees[token] = _collectedProtocolFees[token].add(feeToCollect.toUint128());
            feesToCollect[i] = feeToCollect;
        }
    }
}
