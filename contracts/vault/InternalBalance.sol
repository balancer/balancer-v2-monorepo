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

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../lib/math/Math.sol";
import "../lib/helpers/BalancerErrors.sol";
import "../lib/helpers/InputHelpers.sol";
import "../lib/helpers/ReentrancyGuard.sol";
import "../lib/openzeppelin/SafeERC20.sol";
import "../lib/openzeppelin/SafeCast.sol";

import "./Fees.sol";
import "./AssetTransfersHandler.sol";

abstract contract InternalBalance is ReentrancyGuard, AssetTransfersHandler, Fees {
    using Math for uint256;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    // Stores all accounts' Internal Balances for each token.
    mapping(address => mapping(IERC20 => uint256)) private _internalTokenBalance;

    function getInternalBalance(address user, IERC20[] memory tokens)
        external
        view
        override
        returns (uint256[] memory balances)
    {
        balances = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            balances[i] = _getInternalBalance(user, tokens[i]);
        }
    }

    function depositToInternalBalance(AssetBalanceTransfer[] memory transfers)
        external
        payable
        override
        nonReentrant
        noEmergencyPeriod
    {
        IAsset asset;
        address sender;
        uint256 amount;
        address recipient;
        bool authenticated = false;
        uint256 wrappedEth = 0;

        for (uint256 i = 0; i < transfers.length; i++) {
            (asset, sender, recipient, amount, authenticated) = _validateTransfer(transfers[i], authenticated);

            _increaseInternalBalance(recipient, _translateToIERC20(asset), amount);

            // _receiveAsset does not check if the caller sent enough ETH, so we keep track of it independently (as
            // multiple deposits may have all deposited ETH).
            _receiveAsset(asset, amount, sender, false);

            if (_isETH(asset)) {
                wrappedEth = wrappedEth.add(amount);
            }
        }

        // Handle any used and remaining ETH.
        _handleRemainingEth(wrappedEth);
    }

    /**
     * @dev Note that this is not marked as `nonReentrant` because `_processInternalBalanceOps` is already doing it
     */
    function withdrawFromInternalBalance(AssetBalanceTransfer[] memory transfers) external override {
        _processInternalBalanceOps(transfers, _withdrawFromInternalBalance);
    }

    function _withdrawFromInternalBalance(
        IAsset asset,
        address sender,
        address recipient,
        uint256 amount
    ) private {
        uint256 amountToSend = amount;
        IERC20 token = _translateToIERC20(asset);

        _decreaseInternalBalance(sender, token, amount, false);

        _sendAsset(asset, amountToSend, payable(recipient), false);
    }

    /**
     * @dev Converts an array of `TokenBalanceTransfer` into an array of `AssetBalanceTransfer`, with no runtime cost.
     */
    function _toAssetBalanceTransfer(TokenBalanceTransfer[] memory tokenTransfers)
        private
        pure
        returns (AssetBalanceTransfer[] memory assetTransfers)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            assetTransfers := tokenTransfers
        }
    }

    /**
     * @dev Note that this is not marked as `nonReentrant` because `_processInternalBalanceOps` is already doing it
     */
    function transferInternalBalance(TokenBalanceTransfer[] memory transfers) external override noEmergencyPeriod {
        // We cast transfers into AssetBalanceTransfers in order to reuse _processInternalBalanceOps.
        _processInternalBalanceOps(_toAssetBalanceTransfer(transfers), _transferInternalBalance);
    }

    function _transferInternalBalance(
        IAsset asset,
        address sender,
        address recipient,
        uint256 amount
    ) private {
        // `transferInteralBalance` doesn't actually support assets: this function complies with the interface expected
        // by `_processInternalBalanceOps` to be able to use that function. We therefore cast assets directly into
        // IERC20, with no translation.
        IERC20 token = _asIERC20(asset);

        _decreaseInternalBalance(sender, token, amount, false);
        _increaseInternalBalance(recipient, token, amount);
    }

    /**
     * @dev Note that this is not marked as `nonReentrant` because `_processInternalBalanceOps` is already doing it
     */
    function transferToExternalBalance(TokenBalanceTransfer[] memory transfers) external override noEmergencyPeriod {
        // We cast transfers into AssetBalanceTransfers in order to reuse _processInternalBalanceOps.
        _processInternalBalanceOps(_toAssetBalanceTransfer(transfers), _transferToExternalBalance);
    }

    function _transferToExternalBalance(
        IAsset asset,
        address sender,
        address recipient,
        uint256 amount
    ) private {
        // `transferToExternalBalance` doesn't actually support assets: this function complies with the interface
        // expected by `_processInternalBalanceOps` to be able to use that function. We therefore cast assets directly
        // into IERC20, with no translation.
        IERC20 token = _asIERC20(asset);

        // Do not charge a withdrawal fee, since it's just making use of the Vault's allowance
        token.safeTransferFrom(sender, recipient, amount);
    }

    /**
     * @dev Increases `account`'s Internal Balance for `token` by `amount`.
     */
    function _increaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount
    ) internal override {
        uint256 currentBalance = _getInternalBalance(account, token);
        uint256 newBalance = currentBalance.add(amount);

        _internalTokenBalance[account][token] = newBalance;

        emit InternalBalanceChanged(account, token, amount.toInt256());
    }

    /**
     * @dev Decreases `account`'s Internal Balance for `token` by `amount`.
     * When `capped` the internal balance will be decreased as much as possible without reverting.
     *
     * Returns the amount that was actually deducted from Internal Balance. Note this might not be equal to `amount`
     * in case it was `capped` and the Internal Balance was actually lower.
     */
    function _decreaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount,
        bool capped
    ) internal override returns (uint256 deducted) {
        uint256 currentBalance = _getInternalBalance(account, token);
        _require(capped || (currentBalance >= amount), Errors.INSUFFICIENT_INTERNAL_BALANCE);

        deducted = Math.min(currentBalance, amount);
        uint256 newBalance = currentBalance - deducted;

        _internalTokenBalance[account][token] = newBalance;
        emit InternalBalanceChanged(account, token, -(deducted.toInt256()));
    }

    /**
     * @dev Returns `account`'s Internal Balance for `token`.
     */
    function _getInternalBalance(address account, IERC20 token) internal view returns (uint256) {
        return _internalTokenBalance[account][token];
    }

    function _processInternalBalanceOps(
        AssetBalanceTransfer[] memory transfers,
        function(IAsset, address, address, uint256) op
    ) private nonReentrant {
        IAsset asset;
        address sender;
        address recipient;
        uint256 amount;
        bool authenticated = false;

        for (uint256 i = 0; i < transfers.length; i++) {
            (asset, sender, recipient, amount, authenticated) = _validateTransfer(transfers[i], authenticated);
            op(asset, sender, recipient, amount);
        }
    }

    /**
     * @dev Decodes an asset balance transfer and validates the actual sender is allowed to operate
     */
    function _validateTransfer(AssetBalanceTransfer memory transfer, bool wasAuthenticated)
        private
        view
        returns (
            IAsset asset,
            address sender,
            address recipient,
            uint256 amount,
            bool authenticated
        )
    {
        sender = transfer.sender;
        authenticated = wasAuthenticated;

        if (sender != msg.sender) {
            // In case we found a `sender` address that is not the actual sender (msg.sender)
            // we ensure it's a relayer allowed by the protocol. Note that we are not computing this check
            // for the next senders, it's a global authorization, we only need to check it once.
            if (!wasAuthenticated) {
                // This will revert in case the actual sender is not allowed by the protocol
                _authenticateCaller();
                authenticated = true;
            }

            // Finally we check the actual msg.sender was also allowed by the `sender`
            _authenticateCallerFor(sender);
        }

        asset = transfer.asset;
        amount = transfer.amount;
        recipient = transfer.recipient;
    }
}
