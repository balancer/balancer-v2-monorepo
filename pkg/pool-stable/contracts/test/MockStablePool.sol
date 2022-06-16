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

import "@balancer-labs/v2-pool-utils/contracts/test/MockFailureModes.sol";

import "../StablePool.sol";

/**
 * @dev Add the capability to simulate non-convergence of the invariant. All functions that call the iterative
 * `_calculateInvariant` function  are marked with a modifier, and will fail if the `_simulateInvariantFailure`
 * flag has been set.
 */
contract MockStablePool is StablePool, MockFailureModes {
    constructor(
        IVault vault,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 amplificationParameter,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    ) StablePool(
        vault,
        name,
        symbol,
        tokens,
        amplificationParameter,
        swapFeePercentage,
        pauseWindowDuration,
        bufferPeriodDuration,
        owner
    ) {
      // solhint-disable-previous-line no-empty-blocks
    }

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override whenNotInFailureMode(FailureMode.INVARIANT) returns (uint256) {
      return super ._onSwapGivenIn(swapRequest, balances, indexIn, indexOut);
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256[] memory balances,
        uint256 indexIn,
        uint256 indexOut
    ) internal virtual override whenNotInFailureMode(FailureMode.INVARIANT) returns (uint256) {
      return super._onSwapGivenOut(swapRequest, balances, indexIn, indexOut);
    }

    function _onJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    )
        internal
        virtual
        override
        whenNotInFailureMode(FailureMode.INVARIANT)
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory
        )
    {
      return
        super._onJoinPool(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            scalingFactors,
            userData
        );
    }

    function _onExitPool(
        bytes32 poolId,
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 lastChangeBlock,
        uint256 protocolSwapFeePercentage,
        uint256[] memory scalingFactors,
        bytes memory userData
    )
        internal
        virtual
        override
        whenNotInFailureMode(FailureMode.INVARIANT)
        returns (
            uint256 bptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory dueProtocolFeeAmounts
        )
    {
      return
        super._onExitPool(
            poolId,
            sender,
            recipient,
            balances,
            lastChangeBlock,
            protocolSwapFeePercentage,
            scalingFactors,
            userData
        );
    }

    function getRate() public view virtual override whenNotInFailureMode(FailureMode.INVARIANT) returns (uint256) {
      return super.getRate();
    }
}
