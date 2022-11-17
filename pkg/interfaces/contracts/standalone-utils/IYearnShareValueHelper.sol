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

// The YearnShareValueHelper allows us to query a more precise rate than the pricePerShare (pps) provides.
// The pps on the YearnTokenVaul is returned in the precision of the underlying main token (ie: USDC = 6),
// but internally it stores more precision than what is represented in the returned value. So, with larger numbers,
// using the truncated pps can cause precision errors when converting between shares and underlying.
// The YearnShareValueHelper was implemented to overcome this limitation of the pps.
// Contract was written by wavey (yearn dev)
// https://github.com/wavey0x/YearnSharePriceConverter/blob/master/contracts/Helper.sol
interface IYearnShareValueHelper {
    /**
     * @notice returns the amount of tokens required to mint the desired number of shares
     */
    function sharesToAmount(address vault, uint256 shares) external view returns (uint256);

    /**
     * @notice returns the amount of shares required to burn to receive the desired amount of tokens
     */
    function amountToShares(address vault, uint256 amount) external view returns (uint256);
}
