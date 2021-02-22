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

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import "../lib/math/Math.sol";
import "../lib/helpers/InputHelpers.sol";
import "../lib/helpers/ReentrancyGuard.sol";

import "./interfaces/IBasePool.sol";
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
    using Counters for Counters.Counter;

    // Ensure Pool IDs are unique.
    Counters.Counter private _poolNonce;

    // Pool IDs are stored as `bytes32`.
    mapping(bytes32 => bool) private _isPoolRegistered;

    // Stores the Asset Manager for each token of each Pool.
    mapping(bytes32 => mapping(IERC20 => address)) private _poolAssetManagers;

    /**
     * @dev Reverts unless `poolId` corresponds to a registered Pool.
     */
    modifier withRegisteredPool(bytes32 poolId) {
        _ensureRegisteredPool(poolId);
        _;
    }

    /**
     * @dev Reverts unless `poolId` corresponds to a registered Pool, and the caller is the Pool's contract.
     */
    modifier onlyPool(bytes32 poolId) {
        _ensurePoolIsSender(poolId);
        _;
    }

    /**
     * @dev Creates a Pool ID.
     *
     * These are deterministically created by packing into the ID the Pool's contract address and its specialization
     * setting. This saves gas as this data does not need to be written to or read from storage with interacting with
     * the Pool.
     *
     * Since a single contract can register multiple Pools, a unique nonce must be provided to ensure Pool IDs are
     * unique.
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
     * @dev Returns a Pool's address.
     *
     * Due to how Pool IDs are created, this is done with no storage accesses and costs little gas.
     */
    function _getPoolAddress(bytes32 poolId) internal pure returns (address) {
        // | 20 bytes pool address | 2 bytes specialization setting | 10 bytes nonce |
        return address((uint256(poolId) >> (12 * 8)) & (2**(20 * 8) - 1));
    }

    /**
     * @dev Returns a Pool's specialization setting.
     *
     * Due to how Pool IDs are created, this is done with no storage accesses and costs little gas.
     */
    function _getPoolSpecialization(bytes32 poolId) internal pure returns (PoolSpecialization) {
        // | 20 bytes pool address | 2 bytes specialization setting | 10 bytes nonce |
        return PoolSpecialization(uint256(poolId >> (10 * 8)) & (2**(2 * 8) - 1));
    }

    function registerPool(PoolSpecialization specialization) external override nonReentrant returns (bytes32) {
        // Use _totalPools as the Pool ID nonce. uint80 assumes there will never be more than than 2**80 Pools.
        bytes32 poolId = _toPoolId(msg.sender, specialization, uint80(_poolNonce.current()));
        require(!_isPoolRegistered[poolId], "INVALID_POOL_ID"); // Should never happen

        _poolNonce.increment();
        _isPoolRegistered[poolId] = true;

        emit PoolCreated(poolId);
        return poolId;
    }

    function getPoolTokens(bytes32 poolId)
        public
        view
        override
        withRegisteredPool(poolId)
        returns (IERC20[] memory tokens, uint256[] memory balances)
    {
        bytes32[] memory rawBalances;
        (tokens, rawBalances) = _getPoolTokens(poolId);
        balances = rawBalances.totals();
    }

    function getPoolTokenInfo(bytes32 poolId, IERC20 token)
        external
        view
        override
        withRegisteredPool(poolId)
        returns (
            uint256 cash,
            uint256 managed,
            uint256 blockNumber,
            address assetManager
        )
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

        cash = balance.cash();
        managed = balance.managed();
        blockNumber = balance.blockNumber();
        assetManager = _poolAssetManagers[poolId][token];
    }

    function getPool(bytes32 poolId)
        external
        view
        override
        withRegisteredPool(poolId)
        returns (address, PoolSpecialization)
    {
        return (_getPoolAddress(poolId), _getPoolSpecialization(poolId));
    }

    function registerTokens(
        bytes32 poolId,
        IERC20[] calldata tokens,
        address[] calldata assetManagers
    ) external override nonReentrant onlyPool(poolId) {
        InputHelpers.ensureInputLengthMatch(tokens.length, assetManagers.length);

        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            require(tokens.length == 2, "TOKENS_LENGTH_MUST_BE_2");
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

            _poolAssetManagers[poolId][token] = assetManager;
        }

        emit TokensRegistered(poolId, tokens, assetManagers);
    }

    function deregisterTokens(bytes32 poolId, IERC20[] calldata tokens)
        external
        override
        nonReentrant
        onlyPool(poolId)
    {
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            require(tokens.length == 2, "TOKENS_LENGTH_MUST_BE_2");
            _deregisterTwoTokenPoolTokens(poolId, tokens[0], tokens[1]);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _deregisterMinimalSwapInfoPoolTokens(poolId, tokens);
        } else {
            _deregisterGeneralPoolTokens(poolId, tokens);
        }

        // The deregister calls above ensure the total token balance is zero. It is therefore safe to now remove any
        // associated Asset Managers, since they hold no Pool balance.
        for (uint256 i = 0; i < tokens.length; ++i) {
            delete _poolAssetManagers[poolId][tokens[i]];
        }

        emit TokensDeregistered(poolId, tokens);
    }

    function joinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        IERC20[] memory tokens,
        uint256[] memory maxAmountsIn,
        bool fromInternalBalance,
        bytes memory userData
    ) external override nonReentrant withRegisteredPool(poolId) authenticateFor(sender) {
        InputHelpers.ensureInputLengthMatch(tokens.length, maxAmountsIn.length);

        bytes32[] memory balances = _validateTokensAndGetBalances(poolId, tokens);

        // Call the `onJoinPool` hook to get the amounts to send to the Pool and to charge as protocol swap fees for
        // each token.
        (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) = _callOnJoinPool(
            poolId,
            tokens,
            balances,
            sender,
            recipient,
            userData
        );

        for (uint256 i = 0; i < tokens.length; ++i) {
            uint256 amountIn = amountsIn[i];
            require(amountIn <= maxAmountsIn[i], "JOIN_ABOVE_MAX");

            // Receive tokens from the caller - possibly from Internal Balance
            _receiveTokens(tokens[i], amountIn, sender, fromInternalBalance);

            uint256 feeToPay = dueProtocolFeeAmounts[i];

            // Compute the new Pool balances - we reuse the `balances` array to avoid allocating more memory. Note that
            // due protocol fees might be larger than amounts in, resulting in an overall decrease of the Pool's balance
            // for a token.
            balances[i] = amountIn >= feeToPay
                ? balances[i].increaseCash(amountIn - feeToPay) // Don't need checked arithmetic
                : balances[i].decreaseCash(feeToPay - amountIn); // Same as -(int256(amountIn) - int256(feeToPay))

            _increaseCollectedFees(tokens[i], feeToPay);
        }

        // Update the Pool's balance - how this is done depends on the Pool specialization setting.
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            _setTwoTokenPoolCashBalances(poolId, tokens[0], balances[0], tokens[1], balances[1]);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _setMinimalSwapInfoPoolBalances(poolId, tokens, balances);
        } else {
            _setGeneralPoolBalances(poolId, balances);
        }

        emit PoolJoined(poolId, sender, amountsIn, dueProtocolFeeAmounts);
    }

    function exitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        IERC20[] memory tokens,
        uint256[] memory minAmountsOut,
        bool toInternalBalance,
        bytes memory userData
    ) external override nonReentrant withRegisteredPool(poolId) authenticateFor(sender) {
        InputHelpers.ensureInputLengthMatch(tokens.length, minAmountsOut.length);

        bytes32[] memory balances = _validateTokensAndGetBalances(poolId, tokens);

        // Call the `onExitPool` hook to get the amounts to take from the Pool and to charge as protocol swap fees for
        // each token.
        (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) = _callOnExitPool(
            poolId,
            tokens,
            balances,
            sender,
            recipient,
            userData
        );

        for (uint256 i = 0; i < tokens.length; ++i) {
            require(amountsOut[i] >= minAmountsOut[i], "EXIT_BELOW_MIN");
            uint256 amountOut = amountsOut[i];

            // Send tokens from the recipient - possibly to Internal Balance
            uint256 withdrawFee = _sendTokens(tokens[i], amountOut, recipient, toInternalBalance);

            uint256 feeToPay = dueProtocolFeeAmounts[i];

            // Compute the new Pool balances - we reuse the `balances` array to avoid allocating more memory. A Pool's
            // token balance always decreases after an exit (potentially by 0).
            uint256 delta = amountOut.add(feeToPay);
            balances[i] = balances[i].decreaseCash(delta);

            _increaseCollectedFees(tokens[i], feeToPay.add(withdrawFee));
        }

        // Update the Pool's balance - how this is done depends on the Pool specialization setting.
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            _setTwoTokenPoolCashBalances(poolId, tokens[0], balances[0], tokens[1], balances[1]);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _setMinimalSwapInfoPoolBalances(poolId, tokens, balances);
        } else {
            _setGeneralPoolBalances(poolId, balances);
        }

        emit PoolExited(poolId, sender, amountsOut, dueProtocolFeeAmounts);
    }

    /**
     * @dev Takes `amount` tokens of `token` from `sender`.
     *
     * If `fromInternalBalance` is false, tokens will be transferred via `ERC20.transferFrom`. If true, Internal Balance
     * will be deducted instead, and only the difference between `amount` and available Internal Balance transferred (if
     * any).
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

            // toWithdraw is by construction smaller or equal than currentInternalBalance and toReceive, so we don't
            // need checked arithmetic.
            _setInternalBalance(sender, token, currentInternalBalance - toWithdraw);
            toReceive -= toWithdraw;
        }

        if (toReceive > 0) {
            token.safeTransferFrom(sender, address(this), toReceive);
        }
    }

    /**
     * @dev Grants `amount` tokens of `token` to `recipient`.
     *
     * If `toInternalBalance` is false, tokens are transferred via `ERC20.transfer`, after being charged with protocol
     * withdraw fees. If true, the tokens are deposited to Internal Balance, and no fees are charged.
     *
     * Returns the amount of charged protocol fees.
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
            _increaseInternalBalance(recipient, token, amount);
            return 0;
        } else {
            uint256 withdrawFee = _calculateProtocolWithdrawFeeAmount(amount);
            token.safeTransfer(recipient, amount.sub(withdrawFee));
            return withdrawFee;
        }
    }

    /**
     * @dev Internal helper to call the `onJoinPool` hook on a Pool's contract and perform basic validation on the
     * returned values. Avoid stack-too-deep issues.
     */
    function _callOnJoinPool(
        bytes32 poolId,
        IERC20[] memory tokens,
        bytes32[] memory balances,
        address sender,
        address recipient,
        bytes memory userData
    ) private returns (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) {
        (uint256[] memory totalBalances, uint256 latestBlockNumberUsed) = balances.totalsAndMaxBlockNumber();

        address pool = _getPoolAddress(poolId);
        (amountsIn, dueProtocolFeeAmounts) = IBasePool(pool).onJoinPool(
            poolId,
            sender,
            recipient,
            totalBalances,
            latestBlockNumberUsed,
            _getProtocolSwapFee(),
            userData
        );

        InputHelpers.ensureInputLengthMatch(tokens.length, amountsIn.length, dueProtocolFeeAmounts.length);
    }

    /**
     * @dev Internal helper to call the `onExitPool` hook on a Pool's contract and perform basic validation on the
     * returned values. Avoid stack-too-deep issues.
     */
    function _callOnExitPool(
        bytes32 poolId,
        IERC20[] memory tokens,
        bytes32[] memory balances,
        address sender,
        address recipient,
        bytes memory userData
    ) private returns (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) {
        (uint256[] memory totalBalances, uint256 latestBlockNumberUsed) = balances.totalsAndMaxBlockNumber();

        address pool = _getPoolAddress(poolId);
        (amountsOut, dueProtocolFeeAmounts) = IBasePool(pool).onExitPool(
            poolId,
            sender,
            recipient,
            totalBalances,
            latestBlockNumberUsed,
            _getProtocolSwapFee(),
            userData
        );

        InputHelpers.ensureInputLengthMatch(tokens.length, amountsOut.length, dueProtocolFeeAmounts.length);
    }

    /**
     * @dev Returns the total balance for `poolId`'s `expectedTokens`.
     *
     * `expectedTokens` must equal exactly the token array returned by `getPoolTokens`: both arrays must have the same
     * length, elements and order.
     */
    function _validateTokensAndGetBalances(bytes32 poolId, IERC20[] memory expectedTokens)
        internal
        view
        returns (bytes32[] memory)
    {
        (IERC20[] memory actualTokens, bytes32[] memory balances) = _getPoolTokens(poolId);
        InputHelpers.ensureInputLengthMatch(actualTokens.length, expectedTokens.length);

        for (uint256 i = 0; i < actualTokens.length; ++i) {
            require(actualTokens[i] == expectedTokens[i], "TOKENS_MISMATCH");
        }

        return balances;
    }

    // Assets under management

    function getPoolAssetManagers(bytes32 poolId, IERC20[] memory tokens)
        external
        view
        override
        returns (address[] memory assetManagers)
    {
        _ensureRegisteredPool(poolId);
        assetManagers = new address[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];

            _ensureTokenRegistered(poolId, token);
            assetManagers[i] = _poolAssetManagers[poolId][token];
        }
    }

    function withdrawFromPoolBalance(bytes32 poolId, AssetManagerTransfer[] memory transfers)
        external
        override
        nonReentrant
    {
        _ensureRegisteredPool(poolId);
        PoolSpecialization specialization = _getPoolSpecialization(poolId);

        for (uint256 i = 0; i < transfers.length; ++i) {
            IERC20 token = transfers[i].token;
            _ensurePoolAssetManagerIsSender(poolId, token);

            uint256 amount = transfers[i].amount;
            if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
                _minimalSwapInfoPoolCashToManaged(poolId, token, amount);
            } else if (specialization == PoolSpecialization.TWO_TOKEN) {
                _twoTokenPoolCashToManaged(poolId, token, amount);
            } else {
                _generalPoolCashToManaged(poolId, token, amount);
            }

            token.safeTransfer(msg.sender, amount);
            emit PoolBalanceChanged(poolId, msg.sender, token, amount.toInt256());
        }
    }

    function depositToPoolBalance(bytes32 poolId, AssetManagerTransfer[] memory transfers)
        external
        override
        nonReentrant
    {
        _ensureRegisteredPool(poolId);
        PoolSpecialization specialization = _getPoolSpecialization(poolId);

        for (uint256 i = 0; i < transfers.length; ++i) {
            IERC20 token = transfers[i].token;
            _ensurePoolAssetManagerIsSender(poolId, token);

            uint256 amount = transfers[i].amount;
            if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
                _minimalSwapInfoPoolManagedToCash(poolId, token, amount);
            } else if (specialization == PoolSpecialization.TWO_TOKEN) {
                _twoTokenPoolManagedToCash(poolId, token, amount);
            } else {
                _generalPoolManagedToCash(poolId, token, amount);
            }

            token.safeTransferFrom(msg.sender, address(this), amount);
            emit PoolBalanceChanged(poolId, msg.sender, token, -(amount.toInt256()));
        }
    }

    function updateManagedBalance(bytes32 poolId, AssetManagerTransfer[] memory transfers)
        external
        override
        nonReentrant
    {
        _ensureRegisteredPool(poolId);
        PoolSpecialization specialization = _getPoolSpecialization(poolId);

        for (uint256 i = 0; i < transfers.length; ++i) {
            IERC20 token = transfers[i].token;
            _ensurePoolAssetManagerIsSender(poolId, token);

            uint256 amount = transfers[i].amount;
            if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
                _setMinimalSwapInfoPoolManagedBalance(poolId, token, amount);
            } else if (specialization == PoolSpecialization.TWO_TOKEN) {
                _setTwoTokenPoolManagedBalance(poolId, token, amount);
            } else {
                _setGeneralPoolManagedBalance(poolId, token, amount);
            }
        }
    }

    /**
     * @dev Returns all of `poolId`'s registered tokens, along with their raw balances.
     */
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

    /**
     * @dev Reverts unless `poolId` corresponds to a registered Pool.
     */
    function _ensureRegisteredPool(bytes32 poolId) private view {
        require(_isPoolRegistered[poolId], "INVALID_POOL_ID");
    }

    /**
     * @dev Reverts unless `poolId` corresponds to a registered Pool, and the caller is the Pool's contract.
     */
    function _ensurePoolIsSender(bytes32 poolId) private view {
        _ensureRegisteredPool(poolId);
        address pool = _getPoolAddress(poolId);
        require(pool == msg.sender, "CALLER_NOT_POOL");
    }

    /**
     * @dev Reverts unless `poolId` corresponds to a registered Pool, `token` is registered for that Pool, and the
     * caller is the Pool's Asset Manager for `token`.
     */
    function _ensurePoolAssetManagerIsSender(bytes32 poolId, IERC20 token) private view {
        _ensureTokenRegistered(poolId, token);
        require(_poolAssetManagers[poolId][token] == msg.sender, "SENDER_NOT_ASSET_MANAGER");
    }

    /**
     * @dev Reverts unless `token` is registered for `poolId`.
     */
    function _ensureTokenRegistered(bytes32 poolId, IERC20 token) private view {
        require(_isTokenRegistered(poolId, token), "TOKEN_NOT_REGISTERED");
    }

    /**
     * @dev Returns true if `token` is registered for `poolId`.
     */
    function _isTokenRegistered(bytes32 poolId, IERC20 token) private view returns (bool) {
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
