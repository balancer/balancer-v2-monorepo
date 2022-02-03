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

import "./LiquidityBootstrappingPool.sol";

/**
 * @dev The original Liquidity Bootstrapping Pool computes accumulated swap fees from invariant growth, which
 * incorrectly assumes that the token weights do not change. This version is an exact copy of that flawed contract, with
 * a hotfix that hard-codes the protocol fee swap percentage to 0, ignoring the value stored in the Fee Collector.
 */
contract NoProtocolFeeLiquidityBootstrappingPool is LiquidityBootstrappingPool {
    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner,
        bool swapEnabledOnStart
    )
        LiquidityBootstrappingPool(
            vault,
            name,
            symbol,
            tokens,
            normalizedWeights,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner,
            swapEnabledOnStart
        )
    {
        // solhint-disable-previous-line no-empty-blocks
    }

    function onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256,
        bytes memory userData
    ) public virtual override returns (uint256[] memory, uint256[] memory) {
        return super.onJoinPool(poolId, sender, recipient, balances, lastChangeBlock, 0, userData);
    }

    function onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256,
        bytes memory userData
    ) public virtual override returns (uint256[] memory, uint256[] memory) {
        return super.onExitPool(poolId, sender, recipient, balances, lastChangeBlock, 0, userData);
    }
}
