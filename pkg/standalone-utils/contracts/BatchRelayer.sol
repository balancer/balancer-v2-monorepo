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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ReentrancyGuard.sol";

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";
import "@balancer-labs/v2-distributors/contracts/interfaces/IMultiRewards.sol";

/**
 * @title Batch Relayer
 * @dev This relayer acts as a first step to generalising swaps, joins and exits.
 *      Users may atomically join a pool and use the BPT as the input to a swap or swap for BPT and exit the pool.
 */
contract BatchRelayer is ReentrancyGuard {
    using Address for address payable;

    IVault private immutable _vault;
    IMultiRewards private immutable _stakingContract;

    uint256 private constant _EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0;

    constructor(IVault vault, IMultiRewards stakingContract) {
        _vault = vault;
        _stakingContract = stakingContract;
    }

    function getVault() public view returns (IVault) {
        return _vault;
    }

    function getStakingContract() public view returns (IMultiRewards) {
        return _stakingContract;
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
    ) external payable nonReentrant returns (int256[] memory swapAmounts) {
        getVault().joinPool{ value: msg.value }(poolId, msg.sender, address(this), request);

        IERC20 bpt = IERC20(_getPoolAddress(poolId));
        uint256 bptAmount = bpt.balanceOf(address(this));

        // Ensure that the BPT gained from the join is all used in the swap
        require(assets[swaps[0].assetInIndex] == IAsset(address(bpt)), "Must use BPT as input to swap");

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

        swapAmounts = getVault().batchSwap(IVault.SwapKind.GIVEN_IN, swaps, assets, funds, limits, deadline);
        _sweepETH();
    }

    function joinAndStake(
        bytes32 poolId,
        address payable recipient,
        IVault.JoinPoolRequest calldata joinPoolRequest
    ) external payable nonReentrant {
        getVault().joinPool{ value: msg.value }(poolId, msg.sender, address(this), joinPoolRequest);

        IERC20 bpt = IERC20(_getPoolAddress(poolId));
        uint256 bptAmount = bpt.balanceOf(address(this));

        // If necessary, give staking contract allowance to take BPT
        if (bpt.allowance(address(this), address(getStakingContract())) < bptAmount) {
            bpt.approve(address(getStakingContract()), type(uint256).max);
        }

        getStakingContract().stake(bpt, bptAmount, recipient);
        _sweepETH();
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
    ) external payable nonReentrant {
        // We can't output tokens to the user's internal balance
        // as they need to have BPT on their address for the exit
        // Similarly, accepting ETH requires us to pull from external balances
        IVault.FundManagement memory funds = IVault.FundManagement({
            sender: msg.sender,
            fromInternalBalance: false,
            recipient: msg.sender,
            toInternalBalance: false
        });
        int256[] memory swapAmounts = getVault().batchSwap{ value: msg.value }(
            kind,
            swaps,
            assets,
            funds,
            limits,
            deadline
        );

        // Prevent stack-too-deep
        {
            // Read amount of BPT from BatchSwap return value
            uint256 bptAmount;
            IAsset bpt = IAsset(_getPoolAddress(poolId));
            for (uint256 i; i < assets.length; i++) {
                if (assets[i] == bpt) {
                    require(swapAmounts[i] < 0, "Invalid amount of BPT");
                    bptAmount = uint256(-swapAmounts[i]);
                    break;
                }
            }

            // Here we overwrite the bptAmountIn field of an `exactBptInForTokenOut`
            // or `exactBptInForTokensOut` exit with the output of the swap
            (uint exitKind,, uint256 tokenOutIndex) = abi.decode(request.userData, (uint256, uint256, uint256));
            request.userData = abi.encode(exitKind, bptAmount, tokenOutIndex);
        }

        getVault().exitPool(poolId, msg.sender, recipient, request);
        _sweepETH();
    }

    function _sweepETH() private {
        uint256 remainingEth = address(this).balance;
        if (remainingEth > 0) {
            msg.sender.sendValue(remainingEth);
        }
    }
}
