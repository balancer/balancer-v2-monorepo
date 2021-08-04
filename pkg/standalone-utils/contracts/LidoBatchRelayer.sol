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

import "./BatchRelayer.sol";
import "./interfaces/IwstETH.sol";

/**
 * @title Batch Relayer
 * @dev This relayer acts as a first step to generalising swaps, joins and exits.
 *      Users may atomically join a pool and use the BPT as the input to a swap or swap for BPT and exit the pool.
 */
contract LidoBatchRelayer is BatchRelayer {
    using Address for address payable;

    IERC20 private immutable _stETH;
    IwstETH private immutable _wstETH;

    constructor(
        IVault vault,
        IMultiRewards stakingContract,
        IwstETH wstETH
    ) BatchRelayer(vault, stakingContract) {
        _stETH = IERC20(wstETH.stETH());
        _wstETH = wstETH;
    }

    function lidoSwap(
        IVault.SingleSwap memory singleSwap,
        IVault.FundManagement memory funds,
        uint256 limit,
        uint256 deadline
    ) external payable returns (uint256 swapAmount) {
        require(funds.sender == msg.sender, "Invalid sender");
        // Cache recipient as we sometimes overwrite this
        address recipient = funds.recipient;

        if (singleSwap.assetIn == IAsset(address(_wstETH))) {
            // If wstETH is an input then we want to send it from the relayer
            // as we wrap it there.
            funds.sender = address(this);
            require(!funds.fromInternalBalance, "Cannot send from internal balance");

            _pullStETHAndWrap(msg.sender, singleSwap.amount);
            _approveToken(IERC20(address(_wstETH)), address(getVault()), singleSwap.amount);
        } else if (singleSwap.assetOut == IAsset(address(_wstETH))) {
            // If wstETH is an output then we want to receive it on the relayer
            // so we can unwrap it before forwarding stETH to the user
            funds.recipient = payable(address(this));
            require(!funds.toInternalBalance, "Cannot send to internal balance");
        } else {
            revert("Does not require wstETH");
        }

        swapAmount = getVault().swap{ value: msg.value }(singleSwap, funds, limit, deadline);

        if (singleSwap.assetOut == IAsset(address(_wstETH))) {
            // Unwrap any received wstETH for the user automatically
            _unwrapAndPushStETH(recipient, swapAmount);
        } else if (singleSwap.kind == IVault.SwapKind.GIVEN_OUT) {
            // GIVEN_OUT swaps with wstETH input may leave some dust on the relayer
            // This should be forwarded on to the user
            _unwrapAndPushStETH(recipient, IERC20(address(_wstETH)).balanceOf(address(this)));
        }

        _sweepETH();
    }

    function lidoBatchSwap(
        IVault.SwapKind kind,
        IVault.BatchSwapStep[] memory swaps,
        IAsset[] calldata assets,
        IVault.FundManagement memory funds,
        int256[] calldata limits,
        uint256 deadline
    ) external payable returns (int256[] memory swapAmounts) {
        require(funds.sender == msg.sender, "Invalid sender");
        // Cache recipient as we sometimes overwrite this
        address recipient = funds.recipient;

        // Find the index of wstETH in the assets array
        uint256 wstETHIndex;
        for (uint256 i; i < assets.length; i++) {
            if (assets[i] == IAsset(address(_wstETH))) {
                wstETHIndex = i;
                break;
            }
            require(i < assets.length, "Does not require wstETH");
        }

        int256 wstETHLimit = limits[wstETHIndex];
        if (wstETHLimit > 0) {
            // If wstETH is an input then we want to send it from the relayer
            // as we wrap it there.
            funds.sender = address(this);
            require(!funds.fromInternalBalance, "Cannot send from internal balance");

            _pullStETHAndWrap(msg.sender, uint256(wstETHLimit));
            _approveToken(IERC20(address(_wstETH)), address(getVault()), uint256(wstETHLimit));
        } else {
            // If wstETH is an output then we want to receive it on the relayer
            // so we can unwrap it before forwarding stETH to the user
            funds.recipient = payable(address(this));
            require(!funds.toInternalBalance, "Cannot send to internal balance");
        }

        swapAmounts = getVault().batchSwap{ value: msg.value }(kind, swaps, assets, funds, limits, deadline);

        if (swapAmounts[wstETHIndex] < 0) {
            // Unwrap any received wstETH for the user automatically
            uint256 wstETHAmount = uint256(-swapAmounts[wstETHIndex]);
            _unwrapAndPushStETH(recipient, wstETHAmount);
        } else if (kind == IVault.SwapKind.GIVEN_OUT) {
            // GIVEN_OUT swaps with wstETH input may leave some dust on the relayer
            // This should be forwarded on to the user
            _unwrapAndPushStETH(recipient, IERC20(address(_wstETH)).balanceOf(address(this)));
        }

        _sweepETH();
    }

    function lidoJoinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.JoinPoolRequest calldata request
    ) external payable {
        require(sender == msg.sender, "Invalid sender");

        // Pull in wstETH, wrap and return to user
        uint256 wstETHAmount;
        for (uint256 i; i < request.assets.length; i++) {
            if (request.assets[i] == IAsset(address(_wstETH))) {
                wstETHAmount = request.maxAmountsIn[i];
                break;
            }
            require(i < request.assets.length, "Does not require wstETH");
        }
        _pullStETHAndWrap(sender, wstETHAmount);
        IERC20(address(_wstETH)).transfer(sender, wstETHAmount);

        getVault().joinPool{ value: msg.value }(poolId, sender, recipient, request);
        _sweepETH();
    }

    function lidoExitPool(
        bytes32 poolId,
        address sender,
        address payable recipient,
        IVault.ExitPoolRequest calldata request
    ) external payable {
        require(sender == msg.sender, "Invalid sender");

        uint256 wstETHBalanceBefore = IERC20(address(_wstETH)).balanceOf(recipient);

        getVault().exitPool(poolId, sender, recipient, request);

        uint256 wstETHBalanceAfter = IERC20(address(_wstETH)).balanceOf(recipient);

        // Pull in wstETH, unwrap and return to user
        uint256 wstETHAmount = wstETHBalanceAfter - wstETHBalanceBefore;
        _pullToken(recipient, IERC20(address(_wstETH)), wstETHAmount);
        _unwrapAndPushStETH(recipient, wstETHAmount);
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

        _unwrapAndPushStETH(recipient, wstETHAmount);

        _sweepETH();
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
        _pullStETHAndWrap(msg.sender, wstETHAmount);
        _approveToken(IERC20(address(_wstETH)), address(getVault()), wstETHAmount);

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

    function _pullStETHAndWrap(address sender, uint256 wstETHAmount) private returns (uint256) {
        // Calculate amount of stETH necessary for wstETH used by swap
        uint256 stETHAmount = _wstETH.getStETHByWstETH(wstETHAmount);

        // wrap stETH into wstETH
        _pullToken(sender, _stETH, stETHAmount);
        _approveToken(_stETH, address(_wstETH), stETHAmount);

        return _wstETH.wrap(stETHAmount);
    }

    function _unwrapAndPushStETH(address recipient, uint256 wstETHAmount) private {
        uint256 stETHAmount = _wstETH.unwrap(wstETHAmount);
        _stETH.transfer(recipient, stETHAmount);
    }
}
