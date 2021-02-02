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

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../lib/math/Math.sol";
import "../lib/helpers/ReentrancyGuard.sol";

import "./interfaces/IPool.sol";
import "./InternalBalance.sol";
import "./balances/BalanceAllocation.sol";
import "./balances/GeneralPoolsBalance.sol";
import "./balances/MinimalSwapInfoPoolsBalance.sol";
import "./balances/TwoTokenPoolsBalance.sol";

abstract contract PoolRegistry is
    ReentrancyGuard,
    InternalBalance,
    GeneralPoolsBalance,
    MinimalSwapInfoPoolsBalance,
    TwoTokenPoolsBalance
{
    using Math for uint256;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;
    using BalanceAllocation for bytes32;
    using BalanceAllocation for bytes32[];
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // Set with all Pools in the system
    EnumerableSet.Bytes32Set internal _pools;

    modifier withExistingPool(bytes32 poolId) {
        _ensureExistingPool(poolId);
        _;
    }

    mapping(bytes32 => mapping(IERC20 => address)) private _poolAssetManagers;

    event PoolAssetManagerSet(bytes32 indexed poolId, IERC20 indexed token, address indexed manager);
    event PoolBalanceChanged(bytes32 indexed poolId, address indexed assetManager, IERC20 indexed token, int256 amount);

    modifier onlyPool(bytes32 poolId) {
        _ensurePoolIsSender(poolId);
        _;
    }

    /**
     * @dev Returns a Pool ID. These are deterministically created, by packing into the ID the Pool address and its
     * specialization setting. In order to make them unique, a nonce is also added.
     */
    function _toPoolId(
        address pool,
        PoolSpecialization specialization,
        uint80 nonce
    ) internal pure returns (bytes32) {
        uint256 serialized;

        // | 20 bytes pool address | 2 bytes specialization setting | 10 bytes nonce |
        serialized |= uint256(nonce);
        serialized |= uint256(specialization) << (10 * 8);
        serialized |= uint256(pool) << (12 * 8);

        return bytes32(serialized);
    }

    /**
     * @dev Returns a Pool's address. Due to how Pool IDs are created, this is done with no storage
     * accesses and costs little gas.
     */
    function _getPoolAddress(bytes32 poolId) internal pure returns (address) {
        // | 20 bytes pool address | 2 bytes specialization setting | 10 bytes nonce |
        return address((uint256(poolId) >> (12 * 8)) & (2**(20 * 8) - 1));
    }

    /**
     * @dev Returns a Pool's specialization setting. Due to how Pool IDs are created, this is done with no storage
     * accesses and costs little gas.
     */
    function _getPoolSpecialization(bytes32 poolId) internal pure returns (PoolSpecialization) {
        // | 20 bytes pool address | 2 bytes specialization setting | 10 bytes nonce |
        return PoolSpecialization(uint256(poolId >> (10 * 8)) & (2**(2 * 8) - 1));
    }

    function registerPool(PoolSpecialization specialization) external override nonReentrant returns (bytes32) {
        // We use the Pool length as the Pool ID creation nonce. Since Pools cannot be deleted, nonces are unique. This
        // however assumes there will never be more than than 2**80 Pools.
        bytes32 poolId = _toPoolId(msg.sender, specialization, uint80(_pools.length()));

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

    function getPoolTokens(bytes32 poolId)
        public
        view
        override
        withExistingPool(poolId)
        returns (IERC20[] memory tokens, uint256[] memory balances)
    {
        bytes32[] memory rawBalances;
        (tokens, rawBalances) = _getPoolTokens(poolId);
        balances = rawBalances.totalBalances();
    }

    function getPoolTokenBalanceInfo(bytes32 poolId, IERC20 token)
        external
        view
        override
        withExistingPool(poolId)
        returns (uint256 cash, uint256 managed)
    {
        bytes32 balance;
        PoolSpecialization specialization = _getPoolSpecialization(poolId);

        if (specialization == PoolSpecialization.TWO_TOKEN) {
            balance = _getTwoTokenPoolBalance(poolId, token);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            balance = _getMinimalSwapInfoPoolBalance(poolId, token);
        } else {
            balance = _getGeneralPoolBalance(poolId, token);
        }

        cash = balance.cashBalance();
        managed = balance.managedBalance();
    }

    function getPool(bytes32 poolId)
        external
        view
        override
        withExistingPool(poolId)
        returns (address, PoolSpecialization)
    {
        return (_getPoolAddress(poolId), _getPoolSpecialization(poolId));
    }

    function registerTokens(
        bytes32 poolId,
        IERC20[] calldata tokens,
        address[] calldata assetManagers
    ) external override nonReentrant onlyPool(poolId) {
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            require(tokens.length == 2, "ERR_TOKENS_LENGTH_MUST_BE_2");
            _registerTwoTokenPoolTokens(poolId, tokens[0], tokens[1]);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _registerMinimalSwapInfoPoolTokens(poolId, tokens);
        } else {
            _registerGeneralPoolTokens(poolId, tokens);
        }

        // Assign each token's asset manager
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            address assetManager = assetManagers[i];

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
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            require(tokens.length == 2, "ERR_TOKENS_LENGTH_MUST_BE_2");
            _unregisterTwoTokenPoolTokens(poolId, tokens[0], tokens[1]);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _unregisterMinimalSwapInfoPoolTokens(poolId, tokens);
        } else {
            _unregisterGeneralPoolTokens(poolId, tokens);
        }

        // The unregister calls above ensure the token balance is zero
        // So safe to remove any associated asset managers
        for (uint256 i = 0; i < tokens.length; ++i) {
            delete _poolAssetManagers[poolId][tokens[i]];
        }

        emit TokensUnregistered(poolId, tokens);
    }

    function joinPool(
        bytes32 poolId,
        address recipient,
        IERC20[] memory tokens,
        uint256[] memory maxAmountsIn,
        bool fromInternalBalance,
        bytes memory userData
    ) external override nonReentrant withExistingPool(poolId) {
        require(tokens.length == maxAmountsIn.length, "ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH");

        // The balances array will be modified later on to update the vault balances after the join
        // This is simply to avoid using unnecessary memory
        bytes32[] memory balances = _validateTokensAndGetBalances(poolId, tokens);
        (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) = _callOnJoinPool(
            poolId,
            tokens,
            balances.totalBalances(),
            recipient,
            maxAmountsIn,
            userData
        );

        for (uint256 i = 0; i < tokens.length; ++i) {
            require(amountsIn[i] <= maxAmountsIn[i], "ERR_JOIN_ABOVE_MAX");
            uint256 amountIn = amountsIn[i];

            // Receive tokens
            IERC20 token = tokens[i];
            _receiveTokens(token, amountIn, msg.sender, fromInternalBalance);

            // Charge swap protocol fees to pool
            uint256 feeToPay = dueProtocolFeeAmounts[i];
            _increaseCollectedFees(token, feeToPay);

            // Fees could be larger than the amounts in for a token and end up being a subtraction.
            balances[i] = amountIn >= feeToPay
                ? balances[i].increaseCash(amountIn - feeToPay) // Don't need SafeMath
                : balances[i].decreaseCash(feeToPay - amountIn); // Same as -(int256(amountIn) - int256(feeToPay))
        }

        // Grant tokens to pools - how this is done depends on the Pool specialization setting
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            _updateTwoTokenPoolCashBalances(poolId, tokens[0], balances[0], tokens[1], balances[1]);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _updateMinimalSwapInfoPoolBalances(poolId, tokens, balances);
        } else {
            _updateGeneralPoolBalances(poolId, balances);
        }
        emit PoolJoined(poolId, msg.sender, amountsIn, dueProtocolFeeAmounts);
    }

    function exitPool(
        bytes32 poolId,
        address recipient,
        IERC20[] memory tokens,
        uint256[] memory minAmountsOut,
        bool toInternalBalance,
        bytes memory userData
    ) external override nonReentrant withExistingPool(poolId) {
        require(tokens.length == minAmountsOut.length, "ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH");

        // The balances array will be modified later on to update the vault balances after the join
        // This is simply to avoid using unnecessary memory
        bytes32[] memory balances = _validateTokensAndGetBalances(poolId, tokens);
        (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) = _callOnExitPool(
            poolId,
            tokens,
            balances.totalBalances(),
            recipient,
            minAmountsOut,
            userData
        );

        for (uint256 i = 0; i < tokens.length; ++i) {
            require(amountsOut[i] >= minAmountsOut[i], "ERR_EXIT_BELOW_MIN");
            uint256 amountOut = amountsOut[i];

            // Send tokens
            IERC20 token = tokens[i];
            uint256 withdrawFee = _sendTokens(token, amountOut, recipient, toInternalBalance);

            // Charge swap protocol fees to pool
            uint256 feeToPay = dueProtocolFeeAmounts[i];
            _increaseCollectedFees(token, feeToPay.add(withdrawFee));

            // Compute new balance
            uint256 delta = amountOut.add(feeToPay);
            balances[i] = balances[i].decreaseCash(delta);
        }

        // Grant tokens to pools - how this is done depends on the Pool specialization setting
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            _updateTwoTokenPoolCashBalances(poolId, tokens[0], balances[0], tokens[1], balances[1]);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _updateMinimalSwapInfoPoolBalances(poolId, tokens, balances);
        } else {
            _updateGeneralPoolBalances(poolId, balances);
        }

        emit PoolExited(poolId, msg.sender, amountsOut, dueProtocolFeeAmounts);
    }

    /**
     * @dev Pulls a specific amount of tokens from a sender address.
     * It allows pulling them from the sender's internal balance if specified. In case the internal balance is not
     * enough it will pull the rest from the sender's token balance.
     */
    function _receiveTokens(
        IERC20 token,
        uint256 amount,
        address sender,
        bool fromInternalBalance
    ) internal {
        if (amount == 0) {
            return;
        }

        uint256 toReceive = amount;
        if (fromInternalBalance) {
            uint256 currentInternalBalance = _getInternalBalance(sender, token);
            uint256 toWithdraw = Math.min(currentInternalBalance, amount);
            _setInternalBalance(sender, token, currentInternalBalance - toWithdraw);
            toReceive -= toWithdraw;
        }

        if (toReceive > 0) {
            token.safeTransferFrom(sender, address(this), toReceive);
        }
    }

    /**
     * @dev Send a specific amount of tokens to a recipient address charging the corresponding withdraw fees.
     * It allows transferring them to the internal balance of the recipient if specified (no fees charged).
     */
    function _sendTokens(
        IERC20 token,
        uint256 amount,
        address recipient,
        bool toInternalBalance
    ) internal returns (uint256) {
        if (amount == 0) {
            return 0;
        }

        if (toInternalBalance) {
            // Deposit tokens to the recipient's Internal Balance - the Vault's balance doesn't change
            _increaseInternalBalance(recipient, token, amount);
            return 0;
        } else {
            // Transfer the tokens to the recipient, charging the protocol exit fee
            uint256 withdrawFee = _calculateProtocolWithdrawFeeAmount(amount);
            token.safeTransfer(recipient, amount.sub(withdrawFee));
            return withdrawFee;
        }
    }

    function _callOnJoinPool(
        bytes32 poolId,
        IERC20[] memory tokens,
        uint256[] memory balances,
        address recipient,
        uint256[] memory maxAmountsIn,
        bytes memory userData
    ) private returns (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) {
        address pool = _getPoolAddress(poolId);
        (amountsIn, dueProtocolFeeAmounts) = IPool(pool).onJoinPool(
            poolId,
            msg.sender,
            recipient,
            balances,
            maxAmountsIn,
            getProtocolSwapFee(),
            userData
        );

        require(amountsIn.length == tokens.length, "ERR_AMOUNTS_IN_LENGTH");
        require(dueProtocolFeeAmounts.length == tokens.length, "ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH");
    }

    function _callOnExitPool(
        bytes32 poolId,
        IERC20[] memory tokens,
        uint256[] memory balances,
        address recipient,
        uint256[] memory minAmountsOut,
        bytes memory userData
    ) private returns (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) {
        address pool = _getPoolAddress(poolId);
        (amountsOut, dueProtocolFeeAmounts) = IPool(pool).onExitPool(
            poolId,
            msg.sender,
            recipient,
            balances,
            minAmountsOut,
            getProtocolSwapFee(),
            userData
        );

        require(amountsOut.length == tokens.length, "ERR_AMOUNTS_OUT_LENGTH");
        require(dueProtocolFeeAmounts.length == tokens.length, "ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH");
    }

    /**
     * @dev Require tokens are the same as the pool tokens, in the same order and complete
     */
    function _validateTokensAndGetBalances(bytes32 poolId, IERC20[] memory expectedTokens)
        internal
        view
        returns (bytes32[] memory)
    {
        (IERC20[] memory actualTokens, bytes32[] memory balances) = _getPoolTokens(poolId);
        require(actualTokens.length == expectedTokens.length, "ERR_TOKENS_MISMATCH");

        for (uint256 i = 0; i < actualTokens.length; ++i) {
            require(actualTokens[i] == expectedTokens[i], "ERR_TOKENS_MISMATCH");
        }

        return balances;
    }

    // Assets under management

    modifier onlyPoolAssetManager(bytes32 poolId, IERC20 token) {
        _ensurePoolAssetManagerIsSender(poolId, token);
        _;
    }

    function getPoolAssetManager(bytes32 poolId, IERC20 token)
        external
        view
        override
        withExistingPool(poolId)
        returns (address)
    {
        _ensureTokenRegistered(poolId, token);
        return _poolAssetManagers[poolId][token];
    }

    function withdrawFromPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external override nonReentrant onlyPoolAssetManager(poolId, token) {
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _minimalSwapInfoPoolCashToManaged(poolId, token, amount);
        } else if (specialization == PoolSpecialization.TWO_TOKEN) {
            _twoTokenPoolCashToManaged(poolId, token, amount);
        } else {
            _generalPoolCashToManaged(poolId, token, amount);
        }

        token.safeTransfer(msg.sender, amount);

        // Given amount was already cast to uint128 to be stored, thus we can ensure it fits in an int256
        emit PoolBalanceChanged(poolId, msg.sender, token, amount.toInt256());
    }

    function depositToPoolBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external override nonReentrant onlyPoolAssetManager(poolId, token) {
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _minimalSwapInfoPoolManagedToCash(poolId, token, amount);
        } else if (specialization == PoolSpecialization.TWO_TOKEN) {
            _twoTokenPoolManagedToCash(poolId, token, amount);
        } else {
            _generalPoolManagedToCash(poolId, token, amount);
        }

        token.safeTransferFrom(msg.sender, address(this), amount);

        emit PoolBalanceChanged(poolId, msg.sender, token, amount.toInt256());
    }

    function updateManagedBalance(
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) external override nonReentrant onlyPoolAssetManager(poolId, token) {
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _setMinimalSwapInfoPoolManagedBalance(poolId, token, amount);
        } else if (specialization == PoolSpecialization.TWO_TOKEN) {
            _setTwoTokenPoolManagedBalance(poolId, token, amount);
        } else {
            _setGeneralPoolManagedBalance(poolId, token, amount);
        }
    }

    function _getPoolTokens(bytes32 poolId) internal view returns (IERC20[] memory tokens, bytes32[] memory balances) {
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            return _getTwoTokenPoolTokens(poolId);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            return _getMinimalSwapInfoPoolTokens(poolId);
        } else {
            return _getGeneralPoolTokens(poolId);
        }
    }

    function _ensurePoolIsSender(bytes32 poolId) internal view {
        _ensureExistingPool(poolId);
        address pool = _getPoolAddress(poolId);
        require(pool == msg.sender, "Caller is not the pool");
    }

    function _ensureExistingPool(bytes32 poolId) internal view {
        require(_pools.contains(poolId), "Nonexistent pool");
    }

    function _ensureTokenRegistered(bytes32 poolId, IERC20 token) internal view {
        require(_isTokenRegistered(poolId, token), "ERR_TOKEN_NOT_REGISTERED");
    }

    function _ensurePoolAssetManagerIsSender(bytes32 poolId, IERC20 token) internal view {
        _ensureExistingPool(poolId);
        _ensureTokenRegistered(poolId, token);
        require(_poolAssetManagers[poolId][token] == msg.sender, "SENDER_NOT_ASSET_MANAGER");
    }

    function _isTokenRegistered(bytes32 poolId, IERC20 token) internal view returns (bool) {
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            return _isTwoTokenPoolTokenRegistered(poolId, token);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            return _isMinimalSwapInfoPoolTokenRegistered(poolId, token);
        } else {
            return _isGeneralPoolTokenRegistered(poolId, token);
        }
    }
}
