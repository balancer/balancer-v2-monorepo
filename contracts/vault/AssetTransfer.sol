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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "../lib/math/Math.sol";

import "./interfaces/IWETH.sol";
import "./interfaces/IAsset.sol";

abstract contract AssetTransfer {
    using SafeERC20 for IERC20;
    using Address for address payable;
    using Math for uint256;

    IWETH internal immutable WETH;

    // Sentinel value used to indicate WETH with wrapping/unwrapping semantics. The zero address is a good choice for
    // multiple reasons: it is cheap to pass as a calldata argument, it is a known invalid token and non-contract, and
    // it is an adddress Pools cannot register as a token.
    address internal constant ETH = address(0);

    constructor(IWETH weth) {
        WETH = weth;
    }

    /**
     * @dev Returns true if `asset` is the sentinel value that stands for ETH.
     */
    function _isETH(IAsset asset) internal pure returns (bool) {
        return address(asset) == ETH;
    }

    /**
     * @dev Translates `asset` into an equivalent IERC20 token address. If `asset` stands for ETH, it will be translated
     * into the WETH contract.
     */
    function _translateToIERC20(IAsset asset) internal view returns (IERC20) {
        if (_isETH(asset)) {
            return WETH;
        } else {
            return _asIERC20(asset);
        }
    }

    /**
     * @dev Interprets `asset` as an IERC20 token. This function should only be called on `asset` if `_isETH` previously
     * returned false for it, that is, if `asset` is guaranteed to not be the sentinel value that stands for ETH.
     */
    function _asIERC20(IAsset asset) internal pure returns (IERC20) {
        return IERC20(address(asset));
    }

    function _receiveAssets(
        IAsset asset,
        uint256 amount,
        address sender,
        bool fromInternalBalance
    ) internal {
        if (amount == 0) {
            return;
        }

        if (_isETH(asset)) {
            // Receiving ETH is special for two reasons.
            // First, ETH cannot be withdrawn from Internal Balance (since it also cannot be deposited), so that
            // setting is ignored for ETH.
            // Second, ETH is not pulled from the sender but rather forwarded by the caller. Because the caller
            // might not now exactly how much ETH the swap will require, they may send extra amounts. Any excess
            // will be returned *to the caller*, not the sender. If caller and sender are not the same (because
            // caller is a relayer for sender), then it is up to the caller to manage this returned ETH.

            // !!!!!
            //
            // Must be called only once per transaction!
            //
            // !!!!!
            require(msg.value >= amount);

            // The ETH amount to receive is deposited into the WETH contract, which will in turn mint WETH for
            // the Vault at a 1:1 ratio.
            WETH.deposit{ value: amount }();

            // Any leftover ETH is sent back to the caller (not the sender!).
            uint256 leftover = msg.value - amount;
            if (leftover > 0) {
                msg.sender.sendValue(leftover);
            }
        } else {
            IERC20 token = _asIERC20(asset);

            if (fromInternalBalance) {
                uint256 currentInternalBalance = _getInternalBalance(sender, token);
                uint256 toWithdraw = Math.min(currentInternalBalance, amount);

                // toWithdraw is by construction smaller or equal than currentInternalBalance and toReceive, so we don't
                // need checked arithmetic.
                _setInternalBalance(sender, token, currentInternalBalance - toWithdraw);
                amount -= toWithdraw;
            }

            if (amount > 0) {
                token.safeTransferFrom(sender, address(this), amount);
            }
        }
    }

    function _sendAssets(
        IAsset asset,
        uint256 amount,
        address payable recipient,
        bool toInternalBalance,
        uint256 withdrawFee
    ) internal returns (uint256) {
        if (amount == 0) {
            return 0;
        }

        uint256 toSend = amount.sub(withdrawFee);

        if (_isETH(asset)) {
            // Sending ETH is not as involved as receiving it: the only special behavior it has is ignoring the
            // setting to deposit to Internal Balance.

            // First, the Vault withdraws deposited ETH in the WETH contract, by burning the same amount of WETH
            // from the Vault. This receipt will be handled by the Vault's `receive`.
            WETH.withdraw(toSend);

            // Then, the withdrawn ETH is sent to the recipient.
            recipient.sendValue(toSend);

            return withdrawFee;
        } else {
            IERC20 token = _asIERC20(asset);
            if (toInternalBalance) {
                _increaseInternalBalance(recipient, token, amount);
                return 0;
            } else {
                token.safeTransfer(recipient, toSend);
                return withdrawFee;
            }
        }
    }

    function _getInternalBalance(address account, IERC20 token) internal view virtual returns (uint256);

    function _increaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount
    ) internal virtual;

    function _setInternalBalance(
        address account,
        IERC20 token,
        uint256 balance
    ) internal virtual;
}
