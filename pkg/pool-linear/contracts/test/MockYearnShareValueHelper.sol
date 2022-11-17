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

import "@balancer-labs/v2-interfaces/contracts/standalone-utils/IYearnShareValueHelper.sol";
import "@balancer-labs/v2-interfaces/contracts/pool-linear/IYearnTokenVault.sol";

contract MockYearnShareValueHelper is IYearnShareValueHelper {
    constructor() { 
        // solhint-disable-previous-line no-empty-blocks
    }

    /**
     * @notice returns the amount of tokens required to mint the desired number of shares
     */
    function sharesToAmount(address vault, uint256 shares) external override view returns (uint256) {
        IYearnTokenVault tokenVault = IYearnTokenVault(vault);
        
        return shares * tokenVault.pricePerShare() / 10**tokenVault.decimals();
    }

    /**
     * @notice returns the amount of shares required to burn to receive the desired amount of tokens
     */
    function amountToShares(address vault, uint256 amount) external override view returns (uint256) {
        IYearnTokenVault tokenVault = IYearnTokenVault(vault);
        
        return amount / tokenVault.pricePerShare() * 10**tokenVault.decimals();
    }
}
