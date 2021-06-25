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

import "@balancer-labs/v2-asset-manager-utils/contracts/IAssetManager.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/helpers/BalancerErrors.sol";

import "./BasePool.sol";
import "./interfaces/IRebalancedBasePoolRelayer.sol";

/**
 * @dev Base Pool associated with a relayer that guarantees it can only be joined/exited from the relayer itself.
 * This contract as a simple mixin for pools. Implementing pools must make sure to call the BasePool's constructor
 * properly.
 */
abstract contract RebalancedBasePool is BasePool {
    using Math for uint256;
    using Address for address;

    IRebalancedBasePoolRelayer internal immutable _relayer;

    constructor(IRebalancedBasePoolRelayer relayer) {
        _require(address(relayer).isContract(), Errors.RELAYER_NOT_CONTRACT);
        _relayer = relayer;
    }

    function getRelayer() public view returns (IRebalancedBasePoolRelayer) {
        return _relayer;
    }

    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override returns (uint256[] memory amountsIn, uint256[] memory dueProtocolFeeAmounts) {
        (amountsIn, dueProtocolFeeAmounts) =
            super.onJoinPool(poolId, sender, recipient, balances, lastChangeBlock, protocolSwapFeePercentage, userData);
        _ensureAssetManagerBalanced(poolId, amountsIn, dueProtocolFeeAmounts, true);
        return (amountsIn, dueProtocolFeeAmounts);
    }

    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) public virtual override returns (uint256[] memory amountsOut, uint256[] memory dueProtocolFeeAmounts) {
        (amountsOut, dueProtocolFeeAmounts) =
            super.onExitPool(poolId, sender, recipient, balances, lastChangeBlock, protocolSwapFeePercentage, userData);
        _ensureAssetManagerBalanced(poolId, amountsOut, dueProtocolFeeAmounts, false);
        return (amountsOut, dueProtocolFeeAmounts);
    }

    function _ensureAssetManagerBalanced(
        bytes32 poolId,
        uint256[] memory amounts,
        uint256[] memory protocolFeeAmounts,
        bool positive
    ) internal view {
        uint256 totalTokens = _getTotalTokens();
        if (totalTokens > 0) _ensureAssetManagerBalanced(poolId, _token0, amounts[0], protocolFeeAmounts[0], positive);
        if (totalTokens > 1) _ensureAssetManagerBalanced(poolId, _token1, amounts[1], protocolFeeAmounts[1], positive);
        if (totalTokens > 2) _ensureAssetManagerBalanced(poolId, _token2, amounts[2], protocolFeeAmounts[2], positive);
        if (totalTokens > 3) _ensureAssetManagerBalanced(poolId, _token3, amounts[3], protocolFeeAmounts[3], positive);
        if (totalTokens > 4) _ensureAssetManagerBalanced(poolId, _token4, amounts[4], protocolFeeAmounts[4], positive);
        if (totalTokens > 5) _ensureAssetManagerBalanced(poolId, _token5, amounts[5], protocolFeeAmounts[5], positive);
        if (totalTokens > 6) _ensureAssetManagerBalanced(poolId, _token6, amounts[6], protocolFeeAmounts[6], positive);
        if (totalTokens > 7) _ensureAssetManagerBalanced(poolId, _token7, amounts[7], protocolFeeAmounts[7], positive);
    }

    function _ensureAssetManagerBalanced(
        bytes32 poolId,
        IERC20 token,
        uint256 amount,
        uint256 protocolFeeAmount,
        bool positive
    ) internal view {
        (uint256 cash, uint256 managed, , address assetManager) = getVault().getPoolTokenInfo(poolId, token);
        if (assetManager != address(0)) {
            uint256 finalCash = (positive ? cash.add(amount) : cash.sub(amount)).sub(protocolFeeAmount);
            bool shouldRebalance = IAssetManager(assetManager).shouldRebalance(finalCash, managed);
            _require(!shouldRebalance || _relayer.hasCalledPool(poolId), Errors.BASE_POOL_RELAYER_NOT_CALLED);
        }
    }
}
