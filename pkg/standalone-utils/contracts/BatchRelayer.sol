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
 * @title Batch Relayer
 * @dev This relayer acts as a first step to generalising swaps, joins and exits.
 *      Users may atomically join a pool and use the BPT as the input to a swap or swap for BPT and exit the pool.
 */
contract BatchRelayer {
    IVault private immutable _vault;

    constructor(IVault vault) {
        _vault = vault;
    }

    function getVault() public view returns (IVault) {
        return _vault;
    }

    function _getPoolAddress(bytes32 poolId) private pure returns (address) {
        return address(uint256(poolId) >> (12 * 8));
    }

    function joinAndSwap(
        bytes32 poolId,
        address payable recipient,
        IVault.JoinPoolRequest calldata request,
        IVault.BatchSwapStep[] memory swaps,
        IAsset[] calldata assets,
        int256[] calldata limits,
        uint256 deadline
    ) external returns (int256[] memory) {
        getVault().joinPool(poolId, msg.sender, address(this), request);

        // Ensure that the BPT gained from the join is all used in the swap
        require(assets[swaps[0].assetInIndex] == IAsset(_getPoolAddress(poolId)), "Must use BPT as input to swap");

        IERC20 bpt = IERC20(_getPoolAddress(poolId));
        uint256 bptAmount = bpt.balanceOf(address(this));

        // If necessary, give Vault allowance to take BPT
        if (bpt.allowance(address(this), address(getVault())) < bptAmount) {
            bpt.approve(address(getVault()), type(uint256).max);
        }

        // Ensure that all BPT gained from join is used as input to swap
        swaps[0].amount = bptAmount;

        // Feed BPT into a GIVEN_IN batch swap.
        IVault.FundManagement memory funds = IVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: recipient,
            toInternalBalance: false
        });
        return getVault().batchSwap(IVault.SwapKind.GIVEN_IN, swaps, assets, funds, limits, deadline);
    }

    function swapAndExit(
        bytes32 poolId,
        address payable recipient,
        IVault.ExitPoolRequest memory request,
        IVault.SwapKind kind,
        IVault.BatchSwapStep[] calldata swaps,
        IAsset[] calldata assets,
        int256[] calldata limits,
        uint256 deadline
    ) external {
        // We can't output tokens to the user's internal balance
        // as they need to have BPT on their address for the exit
        IVault.FundManagement memory funds = IVault.FundManagement({
            sender: msg.sender,
            fromInternalBalance: true,
            recipient: msg.sender,
            toInternalBalance: false
        });
        int256[] memory swapAmounts = getVault().batchSwap(kind, swaps, assets, funds, limits, deadline);

        // Read amount of BPT from BatchSwap return value
        // uint256 bptAmount;
        // IAsset bpt = IAsset(_getPoolAddress(poolId));
        // for (uint256 i; i < assets.length; i++) {
        //     if (assets[i] == bpt) {
        //         require(swapAmounts[i] > 0, "Invalid amount of BPT");
        //         bptAmount = uint256(swapAmounts[i]);
        //     }
        // }

        // TODO: inject bptAmount into the ExitPoolRequest
        getVault().exitPool(poolId, msg.sender, recipient, request);
    }
}
