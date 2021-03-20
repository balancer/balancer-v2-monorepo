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

abstract contract AssetTransfersHandler {
    using SafeERC20 for IERC20;
    using Address for address payable;
    using Math for uint256;

    // solhint-disable-next-line var-name-mixedcase
    IWETH private immutable _WETH;

    // Sentinel value used to indicate WETH with wrapping/unwrapping semantics. The zero address is a good choice for
    // multiple reasons: it is cheap to pass as a calldata argument, it is a known invalid token and non-contract, and
    // it is an adddress Pools cannot register as a token.
    address private constant _ETH = address(0);

    constructor(IWETH weth) {
        _WETH = weth;
    }

    /**
     * @dev Returns true if `asset` is the sentinel value that stands for ETH.
     */
    function _isETH(IAsset asset) internal pure returns (bool) {
        return address(asset) == _ETH;
    }

    /**
     * @dev Translates `asset` into an equivalent IERC20 token address. If `asset` stands for ETH, it will be translated
     * into the WETH contract.
     */
    function _translateToIERC20(IAsset asset) internal view returns (IERC20) {
        return _isETH(asset) ? _WETH : _asIERC20(asset);
    }

    /**
     * @dev Same as `_translateToIERC20(IAsset)`, but for an entire array.
     */
    function _translateToIERC20(IAsset[] memory assets) internal view returns (IERC20[] memory) {
        IERC20[] memory tokens = new IERC20[](assets.length);
        for (uint256 i = 0; i < assets.length; ++i) {
            tokens[i] = _translateToIERC20(assets[i]);
        }

        return tokens;
    }

    /**
     * @dev Interprets `asset` as an IERC20 token. This function should only be called on `asset` if `_isETH` previously
     * returned false for it, that is, if `asset` is guaranteed to not be the sentinel value that stands for ETH.
     */
    function _asIERC20(IAsset asset) internal pure returns (IERC20) {
        return IERC20(address(asset));
    }

    /**
     * @dev Receives `amount` of `asset` from `sender`. If `fromInternalBalance` is true, as much as possible is first
     * withdrawn from Internal Balance, and the transfer is performed on the remaining amount, if any.
     *
     * If `asset` is ETH, `fromInternalBalance` must be false (as ETH cannot be held as internal balance), and the funds
     * will be wrapped wrapped into WETH.
     *
     * WARNING: this function does not check that the contract caller has actually supplied any ETH - it is up to the
     * caller of this function to check that this is true to prevent the Vault from using its own ETH (though the Vault
     * typically doesn't hold any).
     */
    function _receiveAsset(
        IAsset asset,
        uint256 amount,
        address sender,
        bool fromInternalBalance
    ) internal {
        if (amount == 0) {
            return;
        }

        if (_isETH(asset)) {
            require(!fromInternalBalance, "INVALID_ETH_INTERNAL_BALANCE");

            // The ETH amount to receive is deposited into the WETH contract, which will in turn mint WETH for
            // the Vault at a 1:1 ratio.

            // A check for this condition is also introduced by the compiler, but this one provides a revert reason.
            // Note we're checking for the Vault's total balance, *not* ETH sent in this transaction.
            require(address(this).balance >= amount, "INSUFFICIENT_ETH");
            _WETH.deposit{ value: amount }();
        } else {
            IERC20 token = _asIERC20(asset);

            if (fromInternalBalance) {
                // Note that we ignore the taxable amount here since these assets are not being withdrawn from the Vault
                // but rather reallocated (e.g. as part of a swap or join).
                // Because `receivedFromInternalBalance` will be always the minimum between the current internal balance
                // and the amount to decrease, it is safe to perform unchecked arithmetic.
                (, uint256 receivedFromInternalBalance) = _decreaseInternalBalance(sender, token, amount, true);
                amount -= receivedFromInternalBalance;
            }

            if (amount > 0) {
                token.safeTransferFrom(sender, address(this), amount);
            }
        }
    }

    /**
     * @dev Sends `amount` of `asset` to `recipient`. If `toInternalBalance` is true, the asset is deposited as Internal
     * Balance instead of being transferred.
     *
     * If `asset` is ETH, `toInternalBalance` must be false (as ETH cannot be held as internal balance), and the funds
     * are instead sent directly after unwrapping WETH.
     */
    function _sendAsset(
        IAsset asset,
        uint256 amount,
        address payable recipient,
        bool toInternalBalance,
        bool trackExempt
    ) internal {
        if (amount == 0) {
            return;
        }

        if (_isETH(asset)) {
            // Sending ETH is not as involved as receiving it: the only special behavior it has is it cannot be
            // deposited to Internal Balance.
            require(!toInternalBalance, "INVALID_ETH_INTERNAL_BALANCE");

            // First, the Vault withdraws deposited ETH in the WETH contract, by burning the same amount of WETH
            // from the Vault. This receipt will be handled by the Vault's `receive`.
            _WETH.withdraw(amount);

            // Then, the withdrawn ETH is sent to the recipient.
            recipient.sendValue(amount);
        } else {
            IERC20 token = _asIERC20(asset);
            if (toInternalBalance) {
                _increaseInternalBalance(recipient, token, amount, trackExempt);
            } else {
                token.safeTransfer(recipient, amount);
            }
        }
    }

    /**
     * @dev Returns excess ETH back to the contract caller, assuming `amountUsed` of it has been spent.
     *
     * Because the caller might not now exactly how much ETH a Vault action will require, they may send extra amounts.
     * Note that this excess value is returned *to the contract caller* (msg.sender). If caller and e.g. swap sender are
     * not the same (because the caller is a relayer for the sender), then it is up to the caller to manage this
     * returned ETH.
     *
     * Reverts if the contract caller sent less ETH than `amountUsed`.
     */
    function _returnExcessEthToCaller(uint256 amountUsed) internal {
        require(msg.value >= amountUsed, "INSUFFICIENT_ETH");

        uint256 excess = msg.value - amountUsed;
        if (excess > 0) {
            msg.sender.sendValue(excess);
        }
    }

    /**
     * @dev Reverts in transactions where a user sent ETH, but didn't specify usage of it as an asset. `ethAssetSeen`
     * should be true if any asset held the sentinel value for ETH, and false otherwise.
     */
    function _ensureNoUnallocatedETH(bool ethAssetSeen) internal view {
        if (msg.value > 0) {
            require(ethAssetSeen, "UNALLOCATED_ETH");
        }
    }

    /**
     * @dev Enables the Vault to receive ETH. This is required for it to be able to unwrap WETH, which sends ETH to the
     * caller.
     *
     * Any ETH sent to the Vault outside of the WETH unwrapping mechanism would be forever locked inside the Vault, so
     * we prevent that from happening. Other mechanisms used to send ETH to the Vault (such as selfdestruct, or have it
     * be the recipient of the block mining reward) will result in locked funds, but are not otherwise a security or
     * soundness issue. This check only exists as an attempt to prevent user error.
     */
    receive() external payable {
        require(msg.sender == address(_WETH), "ETH_TRANSFER");
    }

    // This contract has uses virtual internal functions instead of inheriting from the modules that implement them (in
    // this case, Fees and InternalBalance) in order to decouple it from the rest of the system and enable standalone
    // testing by implementing these with mocks.

    function _calculateProtocolWithdrawFeeAmount(uint256 amount) internal view virtual returns (uint256);

    function _increaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount,
        bool track
    ) internal virtual;

    function _decreaseInternalBalance(
        address account,
        IERC20 token,
        uint256 amount,
        bool capped
    ) internal virtual returns (uint256, uint256);
}
