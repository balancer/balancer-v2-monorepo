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
