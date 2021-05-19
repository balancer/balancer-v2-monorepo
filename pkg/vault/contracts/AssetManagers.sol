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

import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/InputHelpers.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/IERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "./UserBalance.sol";
import "./balances/BalanceAllocation.sol";
import "./balances/GeneralPoolsBalance.sol";
import "./balances/MinimalSwapInfoPoolsBalance.sol";
import "./balances/TwoTokenPoolsBalance.sol";

abstract contract AssetManagers is
    ReentrancyGuard,
    GeneralPoolsBalance,
    MinimalSwapInfoPoolsBalance,
    TwoTokenPoolsBalance
{
    using Math for uint256;
    using SafeERC20 for IERC20;

    // Stores the Asset Manager for each token of each Pool.
    mapping(bytes32 => mapping(IERC20 => address)) internal _poolAssetManagers;

    function managePoolBalance(PoolBalanceOp[] memory ops) external override nonReentrant whenNotPaused {
        // This variable could be declared inside the loop, but that causes the compiler to allocate memory on each
        // loop iteration, increasing gas costs.
        PoolBalanceOp memory op;

        for (uint256 i = 0; i < ops.length; ++i) {
            // By indexing the array only once, we don't spend extra gas in the same bounds check.
            op = ops[i];

            bytes32 poolId = op.poolId;
            _ensureRegisteredPool(poolId);

            IERC20 token = op.token;
            _require(_isTokenRegistered(poolId, token), Errors.TOKEN_NOT_REGISTERED);
            _require(_poolAssetManagers[poolId][token] == msg.sender, Errors.SENDER_NOT_ASSET_MANAGER);

            PoolBalanceOpKind kind = op.kind;
            uint256 amount = op.amount;
            (int256 cashDelta, int256 managedDelta) = _performPoolManagementOperation(kind, poolId, token, amount);

            emit PoolBalanceManaged(poolId, msg.sender, token, cashDelta, managedDelta);
        }
    }

    /**
     * @dev Performs the `kind` Asset Manager operation on a Pool.
     *
     * Withdrawals will transfer `amount` tokens to the caller, deposits will transfer `amount` tokens from the caller,
     * and updates will set the managed balance to `amount`.
     *
     * Returns a tuple with the 'cash' and 'managed' balance deltas as a result of this call.
     */
    function _performPoolManagementOperation(
        PoolBalanceOpKind kind,
        bytes32 poolId,
        IERC20 token,
        uint256 amount
    ) private returns (int256, int256) {
        PoolSpecialization specialization = _getPoolSpecialization(poolId);

        if (kind == PoolBalanceOpKind.WITHDRAW) {
            return _withdrawPoolBalance(poolId, specialization, token, amount);
        } else if (kind == PoolBalanceOpKind.DEPOSIT) {
            return _depositPoolBalance(poolId, specialization, token, amount);
        } else {
            // PoolBalanceOpKind.UPDATE
            return _updateManagedBalance(poolId, specialization, token, amount);
        }
    }

    /**
     * @dev Moves `amount` tokens from a Pool's 'cash' to 'managed' balance, and transfers them to the caller.
     *
     * Returns the 'cash' and 'managed' balance deltas as a result of this call, which will be complementary.
     */
    function _withdrawPoolBalance(
        bytes32 poolId,
        PoolSpecialization specialization,
        IERC20 token,
        uint256 amount
    ) private returns (int256 cashDelta, int256 managedDelta) {
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            _twoTokenPoolCashToManaged(poolId, token, amount);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _minimalSwapInfoPoolCashToManaged(poolId, token, amount);
        } else {
            // PoolSpecialization.GENERAL
            _generalPoolCashToManaged(poolId, token, amount);
        }

        if (amount > 0) {
            token.safeTransfer(msg.sender, amount);
        }

        // Since 'cash' and 'managed' are stored as uint112, `amount` is guaranteed to also fit in 112 bits. It will
        // therefore always fit in a 256 bit integer.
        cashDelta = int256(-amount);
        managedDelta = int256(amount);
    }

    /**
     * @dev Moves `amount` tokens from a Pool's 'managed' to 'cash' balance, and transfers them from the caller.
     *
     * Returns the 'cash' and 'managed' balance deltas as a result of this call, which will be complementary.
     */
    function _depositPoolBalance(
        bytes32 poolId,
        PoolSpecialization specialization,
        IERC20 token,
        uint256 amount
    ) private returns (int256 cashDelta, int256 managedDelta) {
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            _twoTokenPoolManagedToCash(poolId, token, amount);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            _minimalSwapInfoPoolManagedToCash(poolId, token, amount);
        } else {
            // PoolSpecialization.GENERAL
            _generalPoolManagedToCash(poolId, token, amount);
        }

        if (amount > 0) {
            token.safeTransferFrom(msg.sender, address(this), amount);
        }

        // Since 'cash' and 'managed' are stored as uint112, `amount` is guaranteed to also fit in 112 bits. It will
        // therefore always fit in a 256 bit integer.
        cashDelta = int256(amount);
        managedDelta = int256(-amount);
    }

    /**
     * @dev Sets a Pool's 'managed' balance to `amount`.
     *
     * Returns the 'cash' and 'managed' balance deltas as a result of this call (the 'cash' delta will always be zero).
     */
    function _updateManagedBalance(
        bytes32 poolId,
        PoolSpecialization specialization,
        IERC20 token,
        uint256 amount
    ) private returns (int256 cashDelta, int256 managedDelta) {
        if (specialization == PoolSpecialization.TWO_TOKEN) {
            managedDelta = _setTwoTokenPoolManagedBalance(poolId, token, amount);
        } else if (specialization == PoolSpecialization.MINIMAL_SWAP_INFO) {
            managedDelta = _setMinimalSwapInfoPoolManagedBalance(poolId, token, amount);
        } else {
            // PoolSpecialization.GENERAL
            managedDelta = _setGeneralPoolManagedBalance(poolId, token, amount);
        }

        cashDelta = 0;
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
            // PoolSpecialization.GENERAL
            return _isGeneralPoolTokenRegistered(poolId, token);
        }
    }
}
