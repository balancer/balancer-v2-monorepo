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

import "@balancer-labs/v2-interfaces/contracts/pool-weighted/WeightedPoolUserData.sol";

import "../BaseGeneralPool.sol";
import "../lib/VaultReentrancyLib.sol";

/**
 * @notice Pool Mock for testing the VaultReentrancyLib.
 * @dev Defines an external "protected function" that reverts when called in the Vault context,
 * and otherwise emits an event.
 */
contract MockReentrancyPool is BaseGeneralPool {
    using BasePoolUserData for bytes;
    using WeightedPoolUserData for bytes;

    uint256 private immutable _totalTokens;

    event ProtectedFunctionCalled();

    constructor(
        IVault vault,
        IVault.PoolSpecialization specialization,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        address[] memory assetManagers,
        uint256 swapFeePercentage,
        uint256 pauseWindowDuration,
        uint256 bufferPeriodDuration,
        address owner
    )
        BasePool(
            vault,
            specialization,
            name,
            symbol,
            tokens,
            assetManagers,
            swapFeePercentage,
            pauseWindowDuration,
            bufferPeriodDuration,
            owner
        )
    {
        _totalTokens = tokens.length;
    }

    /**
     * @dev Public function protected by the library. Works when called externally; reverts if called
     * during a Vault operation (join/swap/exit).
     */
    function protectedFunction() public {
        VaultReentrancyLib.ensureNotInVaultContext(getVault());

        emit ProtectedFunctionCalled();
    }
  
    function protectedViewFunction() public view {
        VaultReentrancyLib.ensureNotInVaultContext(getVault());
    }

    // Vault hooks

    // Overriding all the hooks is technically overkill: if it works in one Vault context, it works in all.
    // We mock up an entire pool with all of them mainly for documentation purposes: in a real pool, these
    // are all the contexts in which callers need to be protected against calling unsafe functions.

    function _onSwapGivenIn(
        SwapRequest memory swapRequest,
        uint256[] memory,
        uint256,
        uint256
    ) internal override returns (uint256) {
      protectedFunction();

      return swapRequest.amount;
    }

    function _onSwapGivenOut(
        SwapRequest memory swapRequest,
        uint256[] memory,
        uint256,
        uint256
    ) internal override returns (uint256) {
      protectedFunction();

      return swapRequest.amount;
    }

    function _onInitializePool(
        bytes32,
        address,
        address,
        uint256[] memory,
        bytes memory userData
    ) internal pure override returns (uint256, uint256[] memory) {
        uint256[] memory amountsIn = userData.initialAmountsIn();
        uint256 bptAmountOut;

        for (uint256 i = 0; i < amountsIn.length; i++) {
            bptAmountOut += amountsIn[i];
        }
  
        return (bptAmountOut, amountsIn);
    }

    function _onJoinPool(
        bytes32,
        address,
        address,
        uint256[] memory balances,
        uint256,
        uint256,
        uint256[] memory,
        bytes memory
    ) internal override returns (uint256, uint256[] memory) {
        protectedFunction();

        return (0, new uint256[](balances.length));
    }

    function _onExitPool(
        bytes32,
        address,
        address,
        uint256[] memory balances,
        uint256,
        uint256 ,
        uint256[] memory,
        bytes memory
    ) internal override returns (uint256, uint256[] memory) {
        protectedFunction();

        return (0, new uint256[](balances.length));
    }

    function _doRecoveryModeExit(
        uint256[] memory balances,
        uint256,
        bytes memory userData
    ) internal override returns (uint256, uint256[] memory) {
        uint256 bptAmountIn = userData.recoveryModeExit();

        protectedFunction();

        return (bptAmountIn, balances);
    }

    // Mock Vault hook to test read-only reentrancy
    function viewHook() external view {
        protectedViewFunction();
    }

    // Stubbed functions

    function _getMaxTokens() internal pure override returns (uint256) {
        return 8;
    }

    function _getTotalTokens() internal view override returns (uint256) {
        return _totalTokens;
    }

    function _scalingFactor(IERC20) internal pure override returns (uint256) {
        return FixedPoint.ONE;
    }

    function _scalingFactors() internal view override returns (uint256[] memory scalingFactors) {
        uint256 numTokens = _getTotalTokens();

        scalingFactors = new uint256[](numTokens);
        for (uint256 i = 0; i < numTokens; i++) {
            scalingFactors[i] = FixedPoint.ONE;
        }
    }
}
