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

import "./relayer/RelayerAssetHelpers.sol";
import "./interfaces/IwstETH.sol";

/**
 * @title Lido Relayer
 * @dev This relayer allows users to use stETH on Balancer without needing to wrap separately.
 *      Users may atomically wrap stETH into wstETH (and vice versa) while performing
 *      swaps, joins and exits on the Vault.
 *  
 *      The functions of this relayer are designed to match the interface of the underlying Vault equivalent.
 *      For more documentation, reference the Balancer Vault interface:
 *      https://github.com/balancer-labs/balancer-v2-monorepo/blob/4233f67035223fe5e7cf079624b9044dafe6e98f/pkg/vault/contracts/interfaces/IVault.sol
 *
 */
contract LidoRelayer is RelayerAssetHelpers, ReentrancyGuard {
    using Address for address payable;

    IERC20 private immutable _stETH;
    IwstETH private immutable _wstETH;

    constructor(IVault vault, IwstETH wstETH) RelayerAssetHelpers(vault) {
        _stETH = IERC20(wstETH.stETH());
        _wstETH = wstETH;
    }

    function swap(
        IVault.SingleSwap memory singleSwap,
        IVault.FundManagement memory funds,
        uint256 limit,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 swapAmount) {
        require(funds.sender == msg.sender, "Invalid sender");
        // Cache recipient as we sometimes overwrite this
        address recipient = funds.recipient;

        if (singleSwap.assetIn == IAsset(address(_wstETH))) {
            // If wstETH is an input then we want to send it from the relayer
            // as we wrap it there.
            funds.sender = address(this);
            require(!funds.fromInternalBalance, "Cannot send from internal balance");

            // For GIVEN_IN swaps we can pull the exact amount necessary
            // otherwise we need to pull the full limit to allow for slippage
            uint256 wstETHAmount = singleSwap.kind == IVault.SwapKind.GIVEN_IN ? singleSwap.amount : limit;
            _pullStETHAndWrap(msg.sender, wstETHAmount);
            _approveToken(IERC20(address(_wstETH)), address(getVault()), wstETHAmount);
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

    /**
     * @dev This function assumes that if stETH is an input then it is the only input (and similarly for outputs)
     *      Attempting to use multiple inputs of which one is stETH will result in a revert.
     *      Attempting to use multiple outputs of which one is stETH will result in loss of funds.
     */
    function batchSwap(
        IVault.SwapKind kind,
        IVault.BatchSwapStep[] calldata swaps,
        IAsset[] calldata assets,
        IVault.FundManagement memory funds,
        int256[] calldata limits,
        uint256 deadline
    ) external payable nonReentrant returns (int256[] memory swapAmounts) {
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
            // If wstETH is being used as input then we want to send it from the relayer
            // as we wrap it there.
            funds.sender = address(this);
            require(!funds.fromInternalBalance, "Cannot send from internal balance");

            _pullStETHAndWrap(msg.sender, uint256(wstETHLimit));
            _approveToken(IERC20(address(_wstETH)), address(getVault()), uint256(wstETHLimit));
        } else {
            // If wstETH is being used as output then we want to receive it on the relayer
            // so we can unwrap it before forwarding stETH to the user
            funds.recipient = payable(address(this));
            require(!funds.toInternalBalance, "Cannot send to internal balance");
        }

        swapAmounts = getVault().batchSwap{ value: msg.value }(kind, swaps, assets, funds, limits, deadline);

        // Unwrap any received wstETH for the user automatically
        // GIVEN_OUT trades and certains choices of limits can leave an unknown amount of wstETH
        // We then must refund the full relayer balance
        _unwrapAndPushStETH(recipient, IERC20(address(_wstETH)).balanceOf(address(this)));

        _sweepETH();
    }

    function joinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        IVault.JoinPoolRequest calldata request
    ) external payable nonReentrant {
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
        // Send wstETH to the sender, as they will be the sender of the join
        IERC20(address(_wstETH)).transfer(sender, wstETHAmount);

        getVault().joinPool{ value: msg.value }(poolId, sender, recipient, request);
        _sweepETH();
    }

    function exitPool(
        bytes32 poolId,
        address sender,
        address payable recipient,
        IVault.ExitPoolRequest calldata request
    ) external nonReentrant {
        require(sender == msg.sender, "Invalid sender");

        uint256 wstETHBalanceBefore = IERC20(address(_wstETH)).balanceOf(recipient);

        getVault().exitPool(poolId, sender, recipient, request);

        uint256 wstETHBalanceAfter = IERC20(address(_wstETH)).balanceOf(recipient);

        // Pull in wstETH, unwrap and return to user
        uint256 wstETHAmount = wstETHBalanceAfter - wstETHBalanceBefore;
        _pullToken(recipient, IERC20(address(_wstETH)), wstETHAmount);
        _unwrapAndPushStETH(recipient, wstETHAmount);
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
