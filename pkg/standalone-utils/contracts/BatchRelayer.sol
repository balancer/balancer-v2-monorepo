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

import "./interfaces/IwstETH.sol";

/**
 * @title Batch Relayer
 * @dev This relayer acts as a first step to generalising swaps, joins and exits.
 *      Users may atomically join a pool and use the BPT as the input to a swap or swap for BPT and exit the pool.
 */
contract BatchRelayer is ReentrancyGuard {
    using Address for address payable;

    IVault private immutable _vault;
    IMultiRewards private immutable _stakingContract;
    IERC20 private immutable _stETH;
    IwstETH private immutable _wstETH;

    uint256 private constant _EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0;

    constructor(
        IVault vault,
        IMultiRewards stakingContract,
        IwstETH wstETH
    ) {
        _vault = vault;
        _stakingContract = stakingContract;
        _stETH = IERC20(wstETH.stETH());
        _wstETH = wstETH;
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
    ) external payable returns (int256[] memory swapAmounts) {
        IVault.FundManagement memory funds = IVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: recipient,
            toInternalBalance: false
        });

        swapAmounts = _joinAndSwap(poolId, request, swaps, funds, assets, limits, deadline);
        _sweepETH();
    }

    /**
     * @dev Specialised version of joinAndSwap where we expect the output of the swap to be wstETH
     * Any wstETH received will be unwrapped into stETH before forwarding it onto the user
     */
    function lidoJoinAndSwap(
        bytes32 poolId,
        address payable recipient,
        IVault.JoinPoolRequest calldata request,
        IVault.BatchSwapStep[] memory swaps,
        IAsset[] calldata assets,
        int256[] calldata limits,
        uint256 deadline
    ) external payable {
        IVault.FundManagement memory funds = IVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });

        int256[] memory swapAmounts = _joinAndSwap(poolId, request, swaps, funds, assets, limits, deadline);

        // Unwrap any received wstETH and forward onto recipient
        uint256 wstETHAmount;
        for (uint256 i; i < assets.length; i++) {
            if (assets[i] == IAsset(address(_wstETH))) {
                require(swapAmounts[i] < 0, "Invalid amount of wstETH");
                wstETHAmount = uint256(-swapAmounts[i]);
                break;
            }
        }

        _pushSteETH(recipient, wstETHAmount);

        _sweepETH();
    }


    function _pushSteETH(address recipient, uint256 wstETHAmount) internal {
        uint256 stETHAmount = _wstETH.unwrap(wstETHAmount);
        _stETH.transfer(recipient, stETHAmount);
    }

    function _joinAndSwap(
        bytes32 poolId,
        IVault.JoinPoolRequest calldata request,
        IVault.BatchSwapStep[] memory swaps,
        IVault.FundManagement memory funds,
        IAsset[] calldata assets,
        int256[] calldata limits,
        uint256 deadline
    ) internal nonReentrant returns (int256[] memory swapAmounts) {
        getVault().joinPool{ value: msg.value }(poolId, msg.sender, address(this), request);

        IERC20 bpt = IERC20(_getPoolAddress(poolId));
        uint256 bptAmount = bpt.balanceOf(address(this));

        // Ensure that the BPT gained from the join is all used in the swap
        require(assets[swaps[0].assetInIndex] == IAsset(address(bpt)), "Must use BPT as input to swap");

        // If necessary, give Vault allowance to take BPT
        _approveToken(bpt, address(getVault()), bptAmount);

        // Ensure that all BPT gained from join is used as input to swap
        swaps[0].amount = bptAmount;

        swapAmounts = getVault().batchSwap(IVault.SwapKind.GIVEN_IN, swaps, assets, funds, limits, deadline);
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
        _approveToken(bpt, address(getStakingContract()), bptAmount);

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
    ) public payable {
        // We can't output tokens to the user's internal balance
        // as they need to have BPT on their address for the exit
        // Similarly, accepting ETH requires us to pull from external balances
        IVault.FundManagement memory funds = IVault.FundManagement({
            sender: msg.sender,
            fromInternalBalance: false,
            recipient: msg.sender,
            toInternalBalance: false
        });
        _swapAndExit(poolId, recipient, request, kind, swaps, funds, assets, limits, deadline);
    }

    /**
     * @dev Specialised version of swapAndExit where we expect the input of the swap to be wstETH
     * The required amount of stETH will be automatically transferred from the user and wrapped
     */
    function lidoSwapAndExit(
        bytes32 poolId,
        address payable recipient,
        IVault.ExitPoolRequest memory request,
        IVault.SwapKind kind,
        IVault.BatchSwapStep[] calldata swaps,
        IAsset[] calldata assets,
        int256[] calldata limits,
        uint256 deadline
    ) external {
        // Ensure that wstETH is used in the swap
        require(assets[swaps[0].assetInIndex] == IAsset(address(_wstETH)), "Must use wstETH as input to swap");

        uint256 wstETHAmount = swaps[0].amount;
        _pullSteETH(msg.sender, wstETHAmount);
        _approveToken(_wstETH, address(getVault()), wstETHAmount);

        // We can't output tokens to the user's internal balance
        // as they need to have BPT on their address for the exit
        IVault.FundManagement memory funds = IVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: msg.sender,
            toInternalBalance: false
        });
        _swapAndExit(poolId, recipient, request, kind, swaps, funds, assets, limits, deadline);
    }

    function _pullSteETH(address sender, uint256 wstETHAmount) internal {
        // Calculate amount of stETH necessary for wstETH used by swap
        uint256 stETHAmount = _wstETH.getStETHByWstETH(wstETHAmount);

        // wrap stETH into wstETH
        _stETH.transferFrom(msg.sender, address(this), stETHAmount);
        _approveToken(_stETH, address(_wstETH), stETHAmount);
        _wstETH.wrap(stETHAmount);
    }

    function _swapAndExit(
        bytes32 poolId,
        address payable recipient,
        IVault.ExitPoolRequest memory request,
        IVault.SwapKind kind,
        IVault.BatchSwapStep[] calldata swaps,
        IVault.FundManagement memory funds,
        IAsset[] calldata assets,
        int256[] calldata limits,
        uint256 deadline
    ) internal nonReentrant {
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

            // Here we overwrite the bptAmountIn field of an `exactBptInForTokenOut` exit with the output of the swap
            (uint256 exitKind, , uint256 tokenOutIndex) = abi.decode(request.userData, (uint256, uint256, uint256));
            request.userData = abi.encode(exitKind, bptAmount, tokenOutIndex);
        }

        getVault().exitPool(poolId, msg.sender, recipient, request);
        _sweepETH();
    }

    function _approveToken(
        IERC20 token,
        address spender,
        uint256 amount
    ) private {
        if (token.allowance(address(this), spender) < amount) {
            token.approve(spender, type(uint256).max);
        }
    }

    function _sweepETH() private {
        uint256 remainingEth = address(this).balance;
        if (remainingEth > 0) {
            msg.sender.sendValue(remainingEth);
        }
    }
}
