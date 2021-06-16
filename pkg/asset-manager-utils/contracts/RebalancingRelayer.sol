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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-pool-utils/contracts/interfaces/IBasePoolRelayer.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";

import "./IAssetManager.sol";

contract RebalancingRelayer is IBasePoolRelayer {
    // We start at a non-zero value to make EIP2200 refunds lower, meaning there'll be a higher chance of them being
    // fully effective.
    bytes32 constant internal _EMPTY_CALLED_POOL = bytes32(0x0000000000000000000000000000000000000000000000000000000000000001);

    modifier rebalance(bytes32 poolId) {
        _require(_calledPool == _EMPTY_CALLED_POOL, Errors.REBALANCING_RELAYER_REENTERED);
        _calledPool = poolId;
        _;
        _calledPool = _EMPTY_CALLED_POOL;
        _rebalance(poolId);
    }

    IVault public immutable vault;
    bytes32 internal _calledPool;

    constructor (IVault _vault) {
        vault = _vault;
        _calledPool = _EMPTY_CALLED_POOL;
    }

    function hasCalledPool(bytes32 poolId) external view override returns (bool) {
        return _calledPool == poolId;
    }

    function joinPool(bytes32 poolId, IVault.JoinPoolRequest memory request) external payable rebalance(poolId) {
        vault.joinPool(poolId, msg.sender, msg.sender, request);
    }

    function exitPool(bytes32 poolId, IVault.ExitPoolRequest memory request) external rebalance(poolId) {
        vault.exitPool(poolId, msg.sender, msg.sender, request);
    }

    function _rebalance(bytes32 poolId) internal {
        (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
        for (uint256 i = 0; i < tokens.length; i++) {
            (,,, address assetManager) = vault.getPoolTokenInfo(poolId, tokens[i]);
            if (assetManager != address(0)) {
                IAssetManager(assetManager).rebalance(poolId);
            }
        }
    }
}
