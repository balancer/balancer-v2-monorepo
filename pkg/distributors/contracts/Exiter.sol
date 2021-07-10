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
import "@balancer-labs/v2-vault/contracts/interfaces/IBasePool.sol";
import "@balancer-labs/v2-pool-weighted/contracts/BaseWeightedPool.sol";

import "./PoolTokenManipulator.sol";

contract Exiter is PoolTokenManipulator {
    constructor(IVault _vault) PoolTokenManipulator(_vault) {
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @notice Exits specified pool with all bpt
     * @param recipient - the recipient of the pool tokens
     * @param pools - The pools to exit from (addresses)
     */
    function callback(IERC20[] calldata pools, address payable recipient) external {
        for (uint256 p; p < pools.length; p++) {
            address poolAddress = address(pools[p]);

            IBasePool poolContract = IBasePool(poolAddress);
            bytes32 poolId = poolContract.getPoolId();
            ensurePoolTokenSetSaved(poolId);

            IERC20 pool = IERC20(poolAddress);
            _exitPool(pool, poolId, recipient);
        }
    }

    /**
     * @notice Exits the pool
     * Exiting to a single token would look like:
     * bytes memory userData = abi.encode(
     * BaseWeightedPool.ExitKind.EXACT_BPT_IN_FOR_ONE_TOKEN_OUT,
     * bptBalance,
     * tokenIndexOut
     * );
     */
    function _exitPool(
        IERC20 pool,
        bytes32 poolId,
        address payable recipient
    ) internal {
        IAsset[] memory assets = _getAssets(poolId);
        uint256[] memory minAmountsOut = new uint256[](assets.length);

        uint256 bptAmountIn = pool.balanceOf(address(this));

        bytes memory userData = abi.encode(BaseWeightedPool.ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptAmountIn);
        bool toInternalBalance = false;

        IVault.ExitPoolRequest memory request = IVault.ExitPoolRequest(
            assets,
            minAmountsOut,
            userData,
            toInternalBalance
        );
        vault.exitPool(poolId, address(this), recipient, request);
    }
}
