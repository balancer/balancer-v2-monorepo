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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/ITetuSmartVault.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-linear/ITetuStrategy.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/Address.sol";
import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-pool-utils/contracts/lib/ExternalCallLib.sol";

import "./IBaseRelayerLibrary.sol";

/**
 * @title TetuWrapping
 * @notice Allows users to wrap and unwrap Tetu tokens
 * @dev All functions must be payable so they can be called from a multicall involving ETH
 */
abstract contract TetuWrapping is IBaseRelayerLibrary {
    using Address for address payable;
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    function wrapTetu(
        ITetuSmartVault wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }
        IERC20 underlying = IERC20(wrappedToken.underlying());

        // The wrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, underlying, amount);
        }

        underlying.safeApprove(address(wrappedToken), amount);
        wrappedToken.depositFor(amount, recipient);

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, _getWrappedAmount(amount, wrappedToken));
        }
    }

    function unwrapTetu(
        ITetuSmartVault wrappedToken,
        address sender,
        address recipient,
        uint256 amount,
        uint256 outputReference
    ) external payable {
        if (_isChainedReference(amount)) {
            amount = _getChainedReferenceValue(amount);
        }

        // The unwrap caller is the implicit sender of tokens, so if the goal is for the tokens
        // to be sourced from outside the relayer, we must first pull them here.
        if (sender != address(this)) {
            require(sender == msg.sender, "Incorrect sender");
            _pullToken(sender, IERC20(address(wrappedToken)), amount);
        }

        wrappedToken.withdraw(amount);
        uint256 withdrawnAmount = _getMainAmount(amount, wrappedToken);
        IERC20 mainToken = IERC20(wrappedToken.underlying());
        mainToken.safeTransferFrom(msg.sender, recipient, withdrawnAmount);

        if (_isChainedReference(outputReference)) {
            _setChainedReferenceValue(outputReference, withdrawnAmount);
        }
    }

    function _getMainAmount(uint256 wrappedAmount, ITetuSmartVault _wrappedToken) private view returns (uint256) {
        uint256 rate = _getWrappedTokenRate(_wrappedToken);
        return wrappedAmount.divDown(rate);
    }

    function _getWrappedAmount(uint256 mainAmount, ITetuSmartVault _wrappedToken) private view returns (uint256) {
        uint256 rate = _getWrappedTokenRate(_wrappedToken);
        return rate.mulDown(mainAmount);
    }

    function _getWrappedTokenRate(ITetuSmartVault _wrappedToken) private view returns (uint256) {
        uint256 wrappedTotalSupply = IERC20(address(_wrappedToken)).totalSupply();
        if (wrappedTotalSupply == 0) {
            return 0;
        }
        // We couldn't use tetuVault.getPricePerFullShare function, since it introduces rounding issues in tokens
        // with a small number of decimals. Therefore, we're calculating the rate using balance and suply
        try _wrappedToken.underlyingBalanceInVault() returns (uint256 underlyingBalanceInVault) {
            address strategy = ITetuSmartVault(address(_wrappedToken)).strategy();
            if (address(strategy) == address(0)) {
                return (10**18 * underlyingBalanceInVault/ wrappedTotalSupply) + 1;
            }

            try ITetuStrategy(strategy).investedUnderlyingBalance() returns (uint256 strategyInvestedUnderlyingBalance) {
                return (10**18 * (underlyingBalanceInVault + strategyInvestedUnderlyingBalance) / wrappedTotalSupply) + 1;
            } catch (bytes memory revertData) {
                // By maliciously reverting here, TetuVault (or any other contract in the call stack)
                // could trick the Pool into reporting invalid data to the query mechanism for swaps/joins/exits.
                // We then check the revert data to ensure this doesn't occur.
                ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
            }
        } catch (bytes memory revertData) {
            // By maliciously reverting here, TetuVault (or any other contract in the call stack)
            // could trick the Pool into reporting invalid data to the query mechanism for swaps/joins/exits.
            // We then check the revert data to ensure this doesn't occur.
            ExternalCallLib.bubbleUpNonMaliciousRevert(revertData);
        }
    }
}
