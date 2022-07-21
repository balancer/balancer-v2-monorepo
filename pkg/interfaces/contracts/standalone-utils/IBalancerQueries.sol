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

import "../vault/IVault.sol";

/**
 * @dev Provides a way to perform queries on swaps, joins and exits, simulating these operations and returning the exact
 * result they would have if called on the Vault given the current state. Note that the results will be affected by
 * other transactions interacting with the Pools involved.
 *
 * All query functions can be called both on-chain and off-chain.
 *
 * If calling them from a contract, note that all query functions are not `view`. Despite this, these functions produce
 * no net state change, and for all intents and purposes can be thought of as if they were indeed `view`. However,
 * calling them via STATICCALL will fail.
 *
 * If calling them from an off-chain client, make sure to use eth_call: most clients default to eth_sendTransaction for
 * non-view functions.
 *
 * In all cases, the `fromInternalBalance` and `toInternalBalance` fields are entirely ignored: we just use the same
 * structs for simplicity.
 */
interface IBalancerQueries {
    function querySwap(IVault.SingleSwap memory singleSwap, IVault.FundManagement memory funds)
        external
        returns (uint256);

    function queryBatchSwap(
        IVault.SwapKind kind,
        IVault.BatchSwapStep[] memory swaps,
        IAsset[] memory assets,
        IVault.FundManagement memory funds
    ) external returns (int256[] memory assetDeltas);

    function queryJoin(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.JoinPoolRequest memory request
    ) external returns (uint256 bptOut, uint256[] memory amountsIn);

    function queryExit(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.ExitPoolRequest memory request
    ) external returns (uint256 bptIn, uint256[] memory amountsOut);
}
