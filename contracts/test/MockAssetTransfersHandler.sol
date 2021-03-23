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

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../lib/math/Math.sol";
import "../lib/math/FixedPoint.sol";

import "../vault/AssetTransfersHandler.sol";

contract MockAssetTransfersHandler is AssetTransfersHandler {
    using Math for uint256;
    using SafeERC20 for IERC20;

    mapping(address => mapping(IERC20 => uint256)) private _internalTokenBalance;

    constructor(IWETH weth) AssetHelpers(weth) {}

    function receiveAsset(
        IAsset asset,
        uint256 amount,
        address sender,
        bool fromInternalBalance
    ) external payable {
        _receiveAsset(asset, amount, sender, fromInternalBalance);
    }

    function sendAsset(
        IAsset asset,
        uint256 amount,
        address payable recipient,
        bool toInternalBalance,
        bool trackExempt
    ) external {
        _sendAsset(asset, amount, recipient, toInternalBalance, trackExempt);
    }

    function getInternalBalance(address account, IERC20 token) external view returns (uint256) {
        return _internalTokenBalance[account][token];
    }

    function depositToInternalBalance(
        address account,
        IERC20 token,
        uint256 amount
    ) external {
        token.safeTransferFrom(account, address(this), amount);
        _increaseInternalBalance(account, token, amount, true);
    }

    function _increaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount,
        bool
    ) internal override {
        _internalTokenBalance[account][token] += amount;
    }

    function _decreaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount,
        bool capped,
        bool
    ) internal override returns (uint256, uint256) {
        uint256 currentBalance = _internalTokenBalance[account][token];
        uint256 toDeduct = capped ? Math.min(currentBalance, amount) : amount;
        _internalTokenBalance[account][token] = currentBalance.sub(toDeduct);

        // For this mock scenario, we consider always the amount to be fully taxable
        return (toDeduct, toDeduct);
    }
}
