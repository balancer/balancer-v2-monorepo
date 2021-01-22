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
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../vendor/ReentrancyGuard.sol";

import "./InternalBalance.sol";

import "./interfaces/IPool.sol";

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
    using FixedPoint for int256;
    using SafeCast for uint256;
    using SafeCast for uint128;

    // Set with all pools in the system
    EnumerableSet.Bytes32Set internal _pools;

    modifier withExistingPool(bytes32 poolId) {
        _ensureExistingPool(poolId);
        _;
    }

    mapping(bytes32 => mapping(IERC20 => address)) private _poolAssetManagers;

    event PoolAssetManagerSet(bytes32 indexed poolId, IERC20 indexed token, address indexed agent);

    modifier onlyPool(bytes32 poolId) {
        _ensurePoolIsSender(poolId);
        _;
    }

    /**
     * @dev Returns a Pool ID. These are deterministically created, by packing into the ID the Pool address and its
     * optimization setting. In order to make them unique, a nonce is also added.
     */
    function _toPoolId(
        address pool,
        PoolOptimization optimization,
        uint80 nonce
    ) internal pure returns (bytes32) {
        uint256 serialized;

        // | 20 bytes pool address | 2 bytes optimization setting | 10 bytes nonce |
        serialized |= uint256(nonce);
        serialized |= uint256(optimization) << (10 * 8);
        serialized |= uint256(pool) << (12 * 8);

        return bytes32(serialized);
    }

    /**
     * @dev Returns a Pool's address. Due to how Pool IDs are created, this is done with no storage
     * accesses and costs little gas.
     */
    function _getPoolAddress(bytes32 poolId) internal pure returns (address) {
        // | 20 bytes pool address | 2 bytes optimization setting | 10 bytes nonce |
        address((uint256(poolId) >> (12 * 8)) & (2**(20 * 8) - 1));
        return address(uint256(poolId) & (2**(20 * 8) - 1));
    }

    /**
     * @dev Returns a Pool's optimization setting. Due to how Pool IDs are created, this is done with no storage
     * accesses and costs little gas.
     */
    function _getPoolOptimization(bytes32 poolId) internal pure returns (PoolOptimization) {
        // | 20 bytes pool address | 2 bytes optimization setting | 10 bytes nonce |
        return PoolOptimization(uint256(poolId >> (10 * 8)) & (2**(2 * 8) - 1));
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
        require((end >= start) && (end - start) <= _pools.length(), "ERR_BAD_INDICES");

        bytes32[] memory poolIds = new bytes32[](end - start);
        for (uint256 i = 0; i < poolIds.length; ++i) {
            poolIds[i] = _pools.at(i + start);
        }

        return poolIds;
    }

    function getPoolTokens(bytes32 poolId) public view override withExistingPool(poolId) returns (IERC20[] memory) {
        PoolOptimization optimization = _getPoolOptimization(poolId);

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

    function getPoolTokenBalances(bytes32 poolId, IERC20[] memory tokens)
        public
        view
        override
        withExistingPool(poolId)
        returns (uint256[] memory)
    {
        PoolOptimization optimization = _getPoolOptimization(poolId);

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
        return (_getPoolAddress(poolId), _getPoolOptimization(poolId));
    }

    function registerTokens(
        bytes32 poolId,
        IERC20[] calldata tokens,
        address[] calldata assetManagers
    ) external override nonReentrant onlyPool(poolId) {
        PoolOptimization optimization = _getPoolOptimization(poolId);
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

            // The asset manager feature is disabled by setting it to the zero address
            _poolAssetManagers[poolId][token] = assetManager;
            emit PoolAssetManagerSet(poolId, token, assetManager);
        }

        emit TokensRegistered(poolId, tokens);
    }

    function unregisterTokens(bytes32 poolId, IERC20[] calldata tokens)
        external
        override
        nonReentrant
        onlyPool(poolId)
    {
        PoolOptimization optimization = _getPoolOptimization(poolId);
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
    ) external override nonReentrant onlyPool(poolId) {
        require(isAgentFor(from, msg.sender), "Caller is not an agent");
        require(tokens.length == amounts.length, "Tokens and total amounts length mismatch");

        // Receive all tokens
        _receiveLiquidity(from, tokens, amounts, withdrawFromInternalBalance);

        // Grant tokens to pools - how this is done depends on the Pool optimization setting
        PoolOptimization optimization = _getPoolOptimization(poolId);
        if (optimization == PoolOptimization.TWO_TOKEN) {
            require(tokens.length == 2, "ERR_TOKENS_LENGTH_MUST_BE_2");
            _increaseTwoTokenPoolCash(poolId, tokens[0], amounts[0].toUint128(), tokens[1], amounts[1].toUint128());
        } else if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _increaseSimplifiedQuotePoolCash(poolId, tokens, amounts);
        } else {
            _increaseStandardPoolCash(poolId, tokens, amounts);
        }
    }

    function joinPool(
        bytes32 poolId,
        address recipient,
        IERC20[] memory tokens,
        uint256[] memory maxAmountsIn,
        bool withdrawFromUserBalance,
        bytes memory userData
    ) external override nonReentrant withExistingPool(poolId) {
        require(tokens.length == maxAmountsIn.length, "ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH");

        {
            // require tokens are the same as the pool tokens, in the same order and complete
            IERC20[] memory poolTokens = getPoolTokens(poolId);
            require(poolTokens.length == tokens.length, "ERR_TOKENS_MISMATCH");
            for (uint256 i = 0; i < poolTokens.length; ++i) {
                require(poolTokens[i] == tokens[i], "ERR_TOKENS_MISMATCH");
            }
        }

        (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) = _callOnJoinPool(
            poolId,
            tokens,
            recipient,
            maxAmountsIn,
            userData
        );

        require(amountsIn.length == tokens.length, "ERR_AMOUNTS_IN_LENGTH");
        require(dueProtocolFeeAmounts.length == tokens.length, "ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH");

        // Signed because the fees might be larger than the amounts in for a token
        int256[] memory poolBalanceDeltas = new int256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];

            uint128 amountIn = amountsIn[i].toUint128();
            require(amountIn <= maxAmountsIn[i], "ERR_JOIN_ABOVE_MAX");

            // Receive token
            {
                uint128 tokensToReceive = amountIn;
                if (tokensToReceive > 0) {
                    if (withdrawFromUserBalance) {
                        uint128 toWithdraw = Math
                            .min(_internalTokenBalance[msg.sender][token], tokensToReceive)
                            .toUint128();

                        // toWithdraw is guaranteed to be less or equal than both of these two amounts because it equals
                        // the smallest of the two, which means the subtraction cannot overflow.
                        _internalTokenBalance[msg.sender][token] -= toWithdraw;
                        tokensToReceive -= toWithdraw;
                    }

                    token.safeTransferFrom(msg.sender, address(this), tokensToReceive);
                }
            }

            uint128 feeToPay = dueProtocolFeeAmounts[i].toUint128();

            // Charge swap protocol fees to pool
            {
                _collectedProtocolFees[token] = _collectedProtocolFees[token].add(feeToPay);
            }

            poolBalanceDeltas[i] = SignedSafeMath.sub(amountIn, feeToPay);
        }

        // Grant tokens to pools - how this is done depends on the Pool optimization setting
        PoolOptimization optimization = _getPoolOptimization(poolId);
        if (optimization == PoolOptimization.TWO_TOKEN) {
            _alterTwoTokenPoolCash(poolId, tokens[0], poolBalanceDeltas[0], tokens[1], poolBalanceDeltas[1]);
        } else if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _alterSimplifiedQuotePoolCash(poolId, tokens, poolBalanceDeltas);
        } else {
            _alterStandardPoolCash(poolId, tokens, poolBalanceDeltas);
        }
    }

    function exitPool(
        bytes32 poolId,
        address recipient,
        IERC20[] memory tokens,
        uint256[] memory minAmountsOut,
        bool depositToInternalBalance,
        bytes memory userData
    ) external override nonReentrant withExistingPool(poolId) {
        require(tokens.length == minAmountsOut.length, "ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH");

        {
            // require tokens are the same as the pool tokens, in the same order and complete
            IERC20[] memory poolTokens = getPoolTokens(poolId);
            require(poolTokens.length == tokens.length, "ERR_TOKENS_MISMATCH");
            for (uint256 i = 0; i < poolTokens.length; ++i) {
                require(poolTokens[i] == tokens[i], "ERR_TOKENS_MISMATCH");
            }
        }

        (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) = _callOnExitPool(
            poolId,
            tokens,
            recipient,
            minAmountsOut,
            userData
        );

        require(amountsOut.length == tokens.length, "ERR_AMOUNTS_OUT_LENGTH");
        require(dueProtocolFeeAmounts.length == tokens.length, "ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH");

        uint256[] memory poolBalanceDeltas = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];

            uint128 amountOut = amountsOut[i].toUint128();
            require(amountOut >= minAmountsOut[i], "ERR_EXIT_BELOW_MIN");

            // Send token
            if (amountOut > 0) {
                if (depositToInternalBalance) {
                    // Deposit tokens to the recipient's Internal Balance - the Vault's balance doesn't change
                    _internalTokenBalance[recipient][token] = _internalTokenBalance[recipient][token].add128(amountOut);
                } else {
                    // Transfer the tokens to the recipient, charging the protocol exit fee
                    uint128 feeAmount = _calculateProtocolWithdrawFeeAmount(amountOut);
                    _collectedProtocolFees[token] = _collectedProtocolFees[token].add(feeAmount);

                    token.safeTransfer(recipient, amountOut.sub(feeAmount));
                }
            }

            uint128 feeToPay = dueProtocolFeeAmounts[i].toUint128();

            // Charge swap protocol fees to pool
            {
                _collectedProtocolFees[token] = _collectedProtocolFees[token].add(feeToPay);
            }

            poolBalanceDeltas[i] = amountOut.add(feeToPay);
        }

        // Grant tokens to pools - how this is done depends on the Pool optimization setting
        PoolOptimization optimization = _getPoolOptimization(poolId);
        if (optimization == PoolOptimization.TWO_TOKEN) {
            _decreaseTwoTokenPoolCash(
                poolId,
                tokens[0],
                poolBalanceDeltas[0].toUint128(),
                tokens[1],
                poolBalanceDeltas[1].toUint128()
            );
        } else if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _decreaseSimplifiedQuotePoolCash(poolId, tokens, poolBalanceDeltas);
        } else {
            _decreaseStandardPoolCash(poolId, tokens, poolBalanceDeltas);
        }
    }

    // Needed to avoid stack too deep issues
    function _callOnJoinPool(
        bytes32 poolId,
        IERC20[] memory tokens,
        address recipient,
        uint256[] memory maxAmountsIn,
        bytes memory userData
    ) private returns (uint256[] memory, uint256[] memory) {
        address pool = _getPoolAddress(poolId);
        uint256[] memory currentBalances = getPoolTokenBalances(poolId, tokens);

        return
            IPool(pool).onJoinPool(
                poolId,
                msg.sender,
                recipient,
                currentBalances,
                maxAmountsIn,
                getProtocolSwapFee(),
                userData
            );
    }

    // Needed to avoid stack too deep issues
    function _callOnExitPool(
        bytes32 poolId,
        IERC20[] memory tokens,
        address recipient,
        uint256[] memory minAmountsOut,
        bytes memory userData
    ) private returns (uint256[] memory, uint256[] memory) {
        address pool = _getPoolAddress(poolId);
        uint256[] memory currentBalances = getPoolTokenBalances(poolId, tokens);

        return
            IPool(pool).onExitPool(
                poolId,
                msg.sender,
                recipient,
                currentBalances,
                minAmountsOut,
                getProtocolSwapFee(),
                userData
            );
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
    ) external override nonReentrant onlyPool(poolId) {
        require(tokens.length == amounts.length, "Tokens and total amounts length mismatch");

        // Deduct tokens from pools - how this is done depends on the Pool optimization setting
        PoolOptimization optimization = _getPoolOptimization(poolId);
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

    function withdrawFromPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external override nonReentrant onlyPoolAssetManager(poolId, token) {
        PoolOptimization optimization = _getPoolOptimization(poolId);
        if (optimization == PoolOptimization.SIMPLIFIED_QUOTE) {
            _simplifiedQuotePoolCashToManaged(poolId, token, amount.toUint128());
        } else if (optimization == PoolOptimization.TWO_TOKEN) {
            _twoTokenPoolCashToManaged(poolId, token, amount.toUint128());
        } else {
            _standardPoolCashToManaged(poolId, token, amount.toUint128());
        }

        token.safeTransfer(msg.sender, amount);
    }

    function depositToPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external override nonReentrant onlyPoolAssetManager(poolId, token) {
        token.safeTransferFrom(msg.sender, address(this), amount);

        PoolOptimization optimization = _getPoolOptimization(poolId);
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
        PoolOptimization optimization = _getPoolOptimization(poolId);
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
    ) external override nonReentrant onlyPool(poolId) returns (uint256[] memory balances) {
        require(tokens.length == collectedFees.length, "Tokens and total collected fees length mismatch");

        uint128 swapFee = getProtocolSwapFee().toUint128();
        PoolOptimization optimization = _getPoolOptimization(poolId);

        if (optimization == PoolOptimization.TWO_TOKEN) {
            require(tokens.length == 2, "ERR_TOKENS_LENGTH_MUST_BE_2");

            IERC20 tokenX = tokens[0];
            IERC20 tokenY = tokens[1];
            uint128 feeToCollectTokenX = _collectProtocolSwapFee(tokenX, collectedFees[0], swapFee).toUint128();
            uint128 feeToCollectTokenY = _collectProtocolSwapFee(tokenY, collectedFees[1], swapFee).toUint128();

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
            feesToCollect[i] = _collectProtocolSwapFee(tokens[i], collectedFees[i], swapFee);
        }
    }

    function _ensurePoolIsSender(bytes32 poolId) private view {
        _ensureExistingPool(poolId);
        address pool = _getPoolAddress(poolId);
        require(pool == msg.sender, "Caller is not the pool");
    }

    function _ensureExistingPool(bytes32 poolId) private view {
        require(_pools.contains(poolId), "Nonexistent pool");
    }

    function _collectProtocolSwapFee(
        IERC20 token,
        uint256 collectedFee,
        uint256 swapFee
    ) private returns (uint256) {
        uint256 feeToCollect = collectedFee.mul(swapFee);
        _collectedProtocolFees[token] = _collectedProtocolFees[token].add(feeToCollect);
        return feeToCollect;
    }
}
