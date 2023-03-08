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

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/SafeERC20.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/ITetuSmartVault.sol";
import "@balancer-labs/v2-interfaces/contracts/standalone-utils/ITetuStrategy.sol";

contract MockTetuShareValueHelper {
    using SafeERC20 for IERC20;
    using FixedPoint for uint256;

    // Since Tetu TokenRate is basically 1 + yield, 1 is a good default value when token is not fully initialized
    uint256 private immutable _defaultRate = FixedPoint.ONE;

    // Exposing these functions to make it easy to calculate rate on tests.
    // Important: This function does not belong to Tetu's token vault!
    function fromTetuAmount(uint256 wrappedAmount, ITetuSmartVault wrappedToken) external view returns (uint256) {
        return _fromTetuAmount(wrappedAmount, wrappedToken);
    }

    // Exposing these functions to make it easy to calculate rate on tests.
    // Important: This function does not belong to Tetu's token vault!
    function toTetuAmount(uint256 mainAmount, ITetuSmartVault wrappedToken) external view returns (uint256) {
        return _toTetuAmount(mainAmount, wrappedToken);
    }

    function _getTokenRate(ITetuSmartVault wrappedToken) internal view returns (uint256) {
        uint256 wrappedTokenTotalSupply = wrappedToken.totalSupply();
        if (wrappedTokenTotalSupply == 0) {
            return _defaultRate;
        } else {
            uint256 underlyingBalanceInVault = wrappedToken.underlyingBalanceInVault();
            uint256 strategyInvestedUnderlyingBalance = _getStrategyInvestedUnderlyingBalance(wrappedToken);
            uint256 balance = underlyingBalanceInVault.add(strategyInvestedUnderlyingBalance);
            // Notice that "balance" and "wrappedTokenTotalSupply" have the same value for decimals. divDown multiplies
            // by FixedPoint.ONE, so _getTokenRate returns 18 decimals
            return balance.divDown(wrappedTokenTotalSupply);
        }
    }

    function _fromTetuAmount(uint256 wrappedAmount, ITetuSmartVault wrappedToken) internal view returns (uint256) {
        uint256 rate = _getTokenRate(wrappedToken);
        return wrappedAmount.mulDown(rate);
    }

    function _toTetuAmount(uint256 mainAmount, ITetuSmartVault wrappedToken) internal view returns (uint256) {
        uint256 rate = _getTokenRate(wrappedToken);
        return mainAmount.divDown(rate);
    }

    function _getStrategyInvestedUnderlyingBalance(ITetuSmartVault wrappedToken) private view returns (uint256) {
        address tetuStrategy = wrappedToken.strategy();
        if (tetuStrategy == address(0)) {
            // strategy address can be 0x00 when not initialized in the token.
            return _defaultRate;
        } else {
            return ITetuStrategy(tetuStrategy).investedUnderlyingBalance();
        }
    }
}
