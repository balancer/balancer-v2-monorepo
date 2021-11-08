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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "../interfaces/IBaseRelayerLibrary.sol";
import "../interfaces/IstETH.sol";
import "../interfaces/IwstETH.sol";

/**
 * @title LidoWrapping
 * @notice Allows users to wrap and unwrap stETH as one of
 * @dev All functions must be payable so that it can be called as part of a multicall involving ETH
 */
abstract contract LidoWrapping is IBaseRelayerLibrary {
    using Address for address payable;

    IERC20 private immutable _stETH;
    IERC20 private immutable _wstETH;

    /**
     * @dev The zero address may be passed as wstETH to safely disable this module
     * @param wstETH - the address of the Lido's wrapped stETH contract
     */
    constructor(IERC20 wstETH) {
        // Safely disable stETH wrapping if no address has been passed for wstETH
        _stETH = wstETH != IERC20(0) ? IERC20(IwstETH(address(wstETH)).stETH()) : IERC20(0);
        _wstETH = wstETH;
    }

    function wrapStETH(
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        // The wrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first them pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, _stETH, amount);
        }

        _stETH.approve(address(_wstETH), amount);
        uint256 result = IwstETH(address(_wstETH)).wrap(amount);

        if (recipient != address(this)) {
            _wstETH.transfer(recipient, result);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, result);
        }
    }

    function unwrapWstETH(
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        // The unwrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first them pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, _wstETH, amount);
        }

        uint256 result = IwstETH(address(_wstETH)).unwrap(amount);

        if (recipient != address(this)) {
            _stETH.transfer(recipient, result);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, result);
        }
    }

    function stakeETH(
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        uint256 result = IstETH(address(_stETH)).submit{ value: amount }(address(this));

        if (recipient != address(this)) {
            _stETH.transfer(recipient, result);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, result);
        }
    }

    function stakeETHAndWrap(
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        // The fallback function on the wstETH contract automatically stakes and wraps any ETH which is sent to it.
        // We can then safely just send the ETH and just have to ensure that the call doesn't revert.
        payable(address(_wstETH)).sendValue(amount);

        // Note that the previous step would be dangerous should _wstETH be set to the zero address,
        // however in this scenario the next line will revert, preventing loss of funds.

        // As the wstETH contract doesn't return how much wstETH was minted we must query this separately.
        uint256 result = IwstETH(address(_wstETH)).getWstETHByStETH(amount);

        if (recipient != address(this)) {
            _wstETH.transfer(recipient, result);
        }

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, result);
        }
    }
}
