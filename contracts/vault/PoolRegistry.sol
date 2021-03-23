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

    function registerPool(PoolSpecialization specialization)
        external
        override
        nonReentrant
        noEmergencyPeriod
        returns (bytes32)
    {
        // Use _totalPools as the Pool ID nonce. uint80 assumes there will never be more than than 2**80 Pools.
        bytes32 poolId = _toPoolId(msg.sender, specialization, uint80(_poolNonce.current()));
        require(!_isPoolRegistered[poolId], "INVALID_POOL_ID"); // Should never happen

        _poolNonce.increment();
        _isPoolRegistered[poolId] = true;

        emit PoolRegistered(poolId);
        return poolId;
    }

    function getPoolTokens(bytes32 poolId)
        external
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
    ) external override nonReentrant noEmergencyPeriod onlyPool(poolId) {
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
        noEmergencyPeriod
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
        PoolBalanceChange memory change
    ) external payable override {
        _joinOrExit(true, poolId, sender, recipient, change);
    }

    function exitPool(
        bytes32 poolId,
        address sender,
        address payable recipient,
        PoolBalanceChange memory change
    ) external override {
        _joinOrExit(false, poolId, sender, recipient, change);
    }

    function _joinOrExit(
        bool join,
        bytes32 poolId,
        address sender,
        address recipient,
        PoolBalanceChange memory change
    ) internal nonReentrant noEmergencyPeriod withRegisteredPool(poolId) authenticateFor(sender) {
        InputHelpers.ensureInputLengthMatch(change.assets.length, change.limits.length);

        IERC20[] memory tokens = _translateToIERC20(change.assets);
        bytes32[] memory balances = _validateTokensAndGetBalances(poolId, tokens);
        (uint256[] memory amounts, uint256[] memory dueProtocolFeeAmounts) = _callPoolBalanceChange(
            join,
            poolId,
            sender,
            recipient,
            change,
            balances
        );

        // Update the Pool's balance - how this is done depends on the Pool specialization setting.
        PoolSpecialization specialization = _getPoolSpecialization(poolId);
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            _setTwoTokenPoolCashBalances(poolId, tokens[0], balances[0], tokens[1], balances[1]);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _setMinimalSwapInfoPoolBalances(poolId, tokens, balances);
        } else {
            _setGeneralPoolBalances(poolId, balances);
        }

        emit PoolBalanceChanged(poolId, sender, join, tokens, amounts, dueProtocolFeeAmounts);
    }

    function _callPoolBalanceChange(
        bool join,
        bytes32 poolId,
        address sender,
        address recipient,
        PoolBalanceChange memory change,
        bytes32[] memory balances
    ) internal returns (uint256[] memory amounts, uint256[] memory dueProtocolFeeAmounts) {
        (uint256[] memory totalBalances, uint256 latestBlockNumberUsed) = balances.totalsAndMaxBlockNumber();

        IBasePool pool = IBasePool(_getPoolAddress(poolId));
        (amounts, dueProtocolFeeAmounts) = join
            ? pool.onJoinPool(
                poolId,
                sender,
                recipient,
                totalBalances,
                latestBlockNumberUsed,
                _getProtocolSwapFee(),
                change.userData
            )
            : pool.onExitPool(
                poolId,
                sender,
                recipient,
                totalBalances,
                latestBlockNumberUsed,
                _getProtocolSwapFee(),
                change.userData
            );

        InputHelpers.ensureInputLengthMatch(balances.length, amounts.length, dueProtocolFeeAmounts.length);

        join
            ? _receiveAssets(sender, change, balances, amounts, dueProtocolFeeAmounts)
            : _sendAssets(payable(recipient), change, balances, amounts, dueProtocolFeeAmounts);
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
        noEmergencyPeriod
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
            emit PoolBalanceManaged(poolId, msg.sender, token, -(amount.toInt256()));
        }
    }

    function depositToPoolBalance(bytes32 poolId, AssetManagerTransfer[] memory transfers)
        external
        override
        nonReentrant
        noEmergencyPeriod
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
            emit PoolBalanceManaged(poolId, msg.sender, token, amount.toInt256());
        }
    }

    function updateManagedBalance(bytes32 poolId, AssetManagerTransfer[] memory transfers)
        external
        override
        nonReentrant
        noEmergencyPeriod
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
    function _ensureRegisteredPool(bytes32 poolId) internal view {
        require(_isPoolRegistered[poolId], "INVALID_POOL_ID");
    }

    function _receiveAssets(
        address sender,
        PoolBalanceChange memory change,
        bytes32[] memory balances,
        uint256[] memory amountsIn,
        uint256[] memory dueProtocolFeeAmounts
    ) private {
        bool ethAssetSeen = false;
        uint256 wrappedETH = 0;

        for (uint256 i = 0; i < change.assets.length; ++i) {
            uint256 amountIn = amountsIn[i];
            require(amountIn <= change.limits[i], "JOIN_ABOVE_MAX");

            // Receive assets from the caller - possibly from Internal Balance
            IAsset asset = change.assets[i];
            _receiveAsset(asset, amountIn, sender, change.useInternalBalance);

            if (_isETH(asset)) {
                ethAssetSeen = true;
                wrappedETH = wrappedETH.add(amountIn);
            }

            uint256 feeToPay = dueProtocolFeeAmounts[i];

            // Compute the new Pool balances - we reuse the `balances` array to avoid allocating more memory. Note that
            // due protocol fees might be larger than amounts in, resulting in an overall decrease of the Pool's balance
            // for a token.
            balances[i] = amountIn >= feeToPay
                ? balances[i].increaseCash(amountIn - feeToPay) // Don't need checked arithmetic
                : balances[i].decreaseCash(feeToPay - amountIn); // Same as -(int256(amountIn) - int256(feeToPay))

            _increaseCollectedFees(_translateToIERC20(asset), feeToPay);
        }

        // We prevent user error by reverting if ETH was sent but not referenced by any asset.
        _ensureNoUnallocatedETH(ethAssetSeen);

        // By returning the excess ETH, we also check that at least wrappedETH has been received.
        _returnExcessEthToCaller(wrappedETH);
    }

    function _sendAssets(
        address payable recipient,
        PoolBalanceChange memory change,
        bytes32[] memory balances,
        uint256[] memory amountsOut,
        uint256[] memory dueProtocolFeeAmounts
    ) private {
        for (uint256 i = 0; i < change.assets.length; ++i) {
            uint256 amountOut = amountsOut[i];
            require(amountOut >= change.limits[i], "EXIT_BELOW_MIN");

            // Send tokens from the recipient - possibly to Internal Balance
            // Tokens deposited to Internal Balance are not later exempt from withdrawal fees.
            uint256 withdrawFee = change.useInternalBalance ? 0 : _calculateProtocolWithdrawFeeAmount(amountOut);
            IAsset asset = change.assets[i];
            _sendAsset(asset, amountOut.sub(withdrawFee), recipient, change.useInternalBalance, false);

            uint256 protocolSwapFee = dueProtocolFeeAmounts[i];

            // Compute the new Pool balances - we reuse the `balances` array to avoid allocating more memory. A Pool's
            // token balance always decreases after an exit (potentially by 0).
            uint256 delta = amountOut.add(protocolSwapFee);
            balances[i] = balances[i].decreaseCash(delta);

            _increaseCollectedFees(_translateToIERC20(asset), protocolSwapFee.add(withdrawFee));
        }
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
