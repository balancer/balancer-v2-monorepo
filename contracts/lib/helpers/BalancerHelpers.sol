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

import "../math/Math.sol";
import "../math/FixedPoint.sol";

import "./InputHelpers.sol";
import "./AssetHelpers.sol";

import "../../pools/BasePool.sol";
import "../../vault/interfaces/IWETH.sol";
import "../../vault/interfaces/IVault.sol";
import "../../vault/balances/BalanceAllocation.sol";

/**
 * @dev This contract simply builds on top of the Balancer V2 architecture to provide useful helpers to users.
 * It connects different functionalities of the protocol components to allow accessing information that would
 * have required a more cumbersome setup if we wanted to provide these already built-in.
 */
contract BalancerHelpers is AssetHelpers {
    using Math for uint256;
    using BalanceAllocation for bytes32;
    using BalanceAllocation for bytes32[];

    IVault public immutable vault;

    constructor(IVault _vault, IWETH weth) AssetHelpers(weth) {
        vault = _vault;
    }

    function queryJoin(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.PoolBalanceChange memory change
    ) external returns (uint256 bptOut, uint256[] memory amountsIn) {
        (address pool, ) = vault.getPool(poolId);
        (bptOut, amountsIn) = _queryPool(poolId, sender, recipient, change, BasePool(pool).queryJoin);
    }

    function queryExit(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.PoolBalanceChange memory change
    ) external returns (uint256 bptIn, uint256[] memory amountsOut) {
        (address pool, ) = vault.getPool(poolId);
        (bptIn, amountsOut) = _queryPool(poolId, sender, recipient, change, BasePool(pool).queryExit);

        // Deduct withdraw fees unless it's using internal balance
        if (!change.useInternalBalance) {
            (, uint256 withdrawFeePct, ) = vault.getProtocolFees();
            for (uint256 i = 0; i < amountsOut.length; i++) {
                uint256 amountOut = amountsOut[i];
                uint256 withdrawFee = FixedPoint.mulUp(amountOut, withdrawFeePct);
                amountsOut[i] = amountOut.sub(withdrawFee);
            }
        }
    }

    function _queryPool(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.PoolBalanceChange memory change,
        function(bytes32, address, address, uint256[] memory, uint256, uint256, bytes memory)
            external
            returns (uint256, uint256[] memory) query
    ) internal returns (uint256, uint256[] memory) {
        (uint256[] memory balances, uint256 latestBlockNumber) = _validateAssetsAndGetBalances(poolId, change.assets);
        (uint256 protocolSwapFee, , ) = vault.getProtocolFees();
        return query(poolId, sender, recipient, balances, latestBlockNumber, protocolSwapFee, change.userData);
    }

    function _validateAssetsAndGetBalances(bytes32 poolId, IAsset[] memory expectedAssets)
        internal
        view
        returns (uint256[] memory balances, uint256 latestBlockNumberUsed)
    {
        IERC20[] memory actualTokens;
        IERC20[] memory expectedTokens = _translateToIERC20(expectedAssets);

        latestBlockNumberUsed = 0;
        (actualTokens, balances) = vault.getPoolTokens(poolId);
        InputHelpers.ensureInputLengthMatch(actualTokens.length, expectedTokens.length);

        for (uint256 i = 0; i < actualTokens.length; ++i) {
            IERC20 token = actualTokens[i];
            require(token == expectedTokens[i], "TOKENS_MISMATCH");
            (, , uint256 blockNumber, ) = vault.getPoolTokenInfo(poolId, token);
            latestBlockNumberUsed = Math.max(latestBlockNumberUsed, blockNumber);
        }
    }
}
