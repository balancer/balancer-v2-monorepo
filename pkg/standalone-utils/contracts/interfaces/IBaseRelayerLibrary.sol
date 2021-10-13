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

/**
 * @title IBaseRelayerLibrary
 */
abstract contract IBaseRelayerLibrary {
    // Copy of IVault.SingleSwap but with a signed value for amount to allow using stored values
    struct RelayerSingleSwap {
        bytes32 poolId;
        IVault.SwapKind kind;
        IAsset assetIn;
        IAsset assetOut;
        int256 amount;
        bytes userData;
    }

    function _processRelayerSingleSwap(RelayerSingleSwap memory singleSwap)
        internal
        returns (IVault.SingleSwap memory swap)
    {
        if (singleSwap.amount < 0) {
            singleSwap.amount = _readTempStorage(singleSwap.amount);
            require(singleSwap.amount >= 0, "Invalid amount");
        }

        // Because we have checked that `amount` is positive, we can safely use assembly to efficiently convert
        // RelayerSingleSwap to IVault.SingleSwap
        // solhint-disable-next-line no-inline-assembly
        assembly {
            swap := singleSwap
        }
    }

    struct RelayerBatchSwapStep {
        bytes32 poolId;
        uint256 assetInIndex;
        uint256 assetOutIndex;
        int256 amount;
        bytes userData;
    }

    function _processRelayerBatchSwapSteps(RelayerBatchSwapStep[] memory batchSwapSteps)
        internal
        returns (IVault.BatchSwapStep[] memory swaps)
    {
        swaps = new IVault.BatchSwapStep[](batchSwapSteps.length);
        for (uint256 i = 0; i < batchSwapSteps.length; i++) {
            swaps[i] = _processRelayerBatchSwapStep(batchSwapSteps[i]);
        }
    }

    function _processRelayerBatchSwapStep(RelayerBatchSwapStep memory batchSwapStep)
        internal
        returns (IVault.BatchSwapStep memory swap)
    {
        if (batchSwapStep.amount < 0) {
            batchSwapStep.amount = _readTempStorage(batchSwapStep.amount);
            require(batchSwapStep.amount >= 0, "Invalid amount");
        }

        // Because we have checked that `amount` is positive, we can safely use assembly to efficiently convert
        // RelayerSingleSwap to IVault.SingleSwap
        // solhint-disable-next-line no-inline-assembly
        assembly {
            swap := batchSwapStep
        }
    }

    function getVault() public view virtual returns (IVault);

    function _readTempStorage(int256 key) internal virtual returns (int256 value);

    function _writeTempStorage(int256 key, int256 value) internal virtual;
}
