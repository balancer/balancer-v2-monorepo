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

import "@balancer-labs/v2-interfaces/contracts/pool-linear/IYearnTokenVault.sol";

// solhint-disable not-rely-on-time

// The YearnShareValueHelper provides a more precise wrappedTokenRate than is available
// from simply using the pricePerShare. This is because the pps is limited to the precision
// of the underlying asset (ie: USDC = 6), but it stores more precision internally, so the 
// larger the amount exchanged, the larger the precision error becomes.
// This implementation was ported from the ShareValueHelper:
// https://github.com/wavey0x/ShareValueHelper/blob/master/contracts/Helper.sol
contract YearnShareValueHelper {
    /**
     * @notice returns the amount of tokens required to mint the desired number of shares
     */
    function _sharesToAmount(address vault, uint256 shares) internal view returns (uint256) {
        uint256 totalSupply = IYearnTokenVault(vault).totalSupply();
        if (totalSupply == 0) return shares;

        uint256 freeFunds = _calculateFreeFunds(vault);

        return (shares * freeFunds) / totalSupply;
    }

    function _calculateFreeFunds(address vault) private view returns (uint256) {
        uint256 totalAssets = IYearnTokenVault(vault).totalAssets();
        uint256 lockedFundsRatio = (block.timestamp - IYearnTokenVault(vault).lastReport()) *
            IYearnTokenVault(vault).lockedProfitDegradation();

        if (lockedFundsRatio < 10**18) {
            uint256 lockedProfit = IYearnTokenVault(vault).lockedProfit();
            lockedProfit -= (lockedFundsRatio * lockedProfit) / 10**18;
            return totalAssets - lockedProfit;
        } else {
            return totalAssets;
        }
    }
}
