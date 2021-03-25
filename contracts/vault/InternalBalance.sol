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

import "./Fees.sol";
import "./AssetTransfersHandler.sol";
import "./balances/InternalBalanceAllocation.sol";

abstract contract InternalBalance is ReentrancyGuard, AssetTransfersHandler, Fees {
    using Math for uint256;
    using SafeERC20 for IERC20;
    using InternalBalanceAllocation for bytes32;

    // Stores all account's Internal Balance for each token.
    mapping(address => mapping(IERC20 => bytes32)) private _internalTokenBalance;

    function getInternalBalance(address user, IERC20[] memory tokens)
        external
        view
        override
        returns (uint256[] memory balances)
    {
        balances = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            balances[i] = _getInternalBalance(user, tokens[i]).actual();
        }
    }

    function depositToInternalBalance(AssetBalanceTransfer[] memory transfers)
        external
        payable
        override
        nonReentrant
        noEmergencyPeriod
    {
        bool ethAssetSeen = false;
        uint256 wrappedETH = 0;

        IAsset asset;
        address sender;
        uint256 amount;
        address recipient;
        bool authenticated = false;

        for (uint256 i = 0; i < transfers.length; i++) {
            (asset, sender, recipient, amount, authenticated) = _validateTransfer(transfers[i], authenticated);

            _increaseInternalBalance(recipient, _translateToIERC20(asset), amount, true);

            // _receiveAsset does not check if the caller sent enough ETH, so we keep track of it independently (as
            // multiple deposits may have all deposited ETH).
            _receiveAsset(asset, amount, sender, false);
            if (_isETH(asset)) {
                ethAssetSeen = true;
                wrappedETH = wrappedETH.add(amount);
            }
        }

        // We prevent user error by reverting if ETH was sent but not allocated to any deposit.
        _ensureNoUnallocatedETH(ethAssetSeen);

        // By returning the excess ETH, we also check that at least wrappedETH has been received.
        _returnExcessEthToCaller(wrappedETH);
    }

    /**
     * @dev Note that this is not marked as `nonReentrant` cause `_processInternalBalanceOps` is already doing it
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

        // Since we're charging withdraw fees, we attempt to withdraw from the exempt Internal Balance if possible
        (uint256 taxableAmount, ) = _decreaseInternalBalance(sender, token, amount, false, true);

        if (taxableAmount > 0) {
            uint256 feeAmount = _calculateWithdrawFee(taxableAmount);
            _payFee(token, feeAmount);
            amountToSend = amountToSend.sub(feeAmount);
        }

        // Tokens withdrawn from Internal Balance are not exempt from withdrawal fees.
        _sendAsset(asset, amountToSend, payable(recipient), false, false);
    }

    /**
     * @dev Note that this is not marked as `nonReentrant` cause `_processInternalBalanceOps` is already doing it
     */
    function transferInternalBalance(AssetBalanceTransfer[] memory transfers) external override noEmergencyPeriod {
        _processInternalBalanceOps(transfers, _transferInternalBalance);
    }

    function _transferInternalBalance(
        IAsset asset,
        address sender,
        address recipient,
        uint256 amount
    ) private {
        _require(!_isETH(asset), Errors.INVALID_ETH_INTERNAL_BALANCE);
        IERC20 token = _translateToIERC20(asset);
        // Transferring internal balance to another account is not charged withdrawal fees.
        // Because of this, we use the exempt balance if possible.
        _decreaseInternalBalance(sender, token, amount, false, false);
        // Tokens transferred internally are not later exempt from withdrawal fees.
        _increaseInternalBalance(recipient, token, amount, false);
    }

    /**
     * @dev Note that this is not marked as `nonReentrant` cause `_processInternalBalanceOps` is already doing it
     */
    function transferToExternalBalance(AssetBalanceTransfer[] memory transfers) external override noEmergencyPeriod {
        _processInternalBalanceOps(transfers, _transferToExternalBalance);
    }

    function _transferToExternalBalance(
        IAsset asset,
        address sender,
        address recipient,
        uint256 amount
    ) private {
        // Do not charge withdrawal fee, since it's just making use of the Vault's allowance
        IERC20 token = _translateToIERC20(asset);
        token.safeTransferFrom(sender, recipient, amount);
    }

    /**
     * @dev Increases `account`'s Internal Balance for `token` by `amount`.
     */
    function _increaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount,
        bool trackExempt
    ) internal override {
        bytes32 currentInternalBalance = _getInternalBalance(account, token);
        bytes32 newBalance = currentInternalBalance.increase(amount, trackExempt);

        // Because Internal Balance is stored in 112 bits internally, we can safely cast to int256 as the value is
        // guaranteed to fit.
        emit InternalBalanceChanged(account, token, int256(amount));

        _internalTokenBalance[account][token] = newBalance;
    }

    /**
     * @dev Decreases `account`'s Internal Balance for `token` by `amount`.
     * When `capped` the internal balance will be decreased as much as possible without reverting.
     * @return taxableAmount The amount that should be used to charge fees. Some functionalities in the Vault
     * allows users to avoid fees when working with internal balance deltas in the same block. This is the case for
     * deposits and withdrawals for example.
     * @return decreasedAmount The amount that was actually decreased, note this might not be equal to `amount` in
     * case it was `capped` and the internal balance was actually lower than it.
     */
    function _decreaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount,
        bool capped,
        bool useExempt
    ) internal override returns (uint256, uint256) {
        bytes32 currentInternalBalance = _getInternalBalance(account, token);
        (bytes32 newBalance, uint256 taxableAmount, uint256 decreasedAmount) = currentInternalBalance.decrease(
            amount,
            capped,
            useExempt
        );

        // Because Internal Balance is stored in 112 bits internally, we can safely cast to int256 as the value is
        // guaranteed to fit.
        emit InternalBalanceChanged(account, token, -int256(amount));

        _internalTokenBalance[account][token] = newBalance;

        return (taxableAmount, decreasedAmount);
    }

    /**
     * @dev Returns `account`'s Internal Balance for `token`.
     */
    function _getInternalBalance(address account, IERC20 token) internal view returns (bytes32) {
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
