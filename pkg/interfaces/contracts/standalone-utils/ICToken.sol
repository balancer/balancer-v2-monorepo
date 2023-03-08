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

// Interface for MidasCapital. An open interest protocol based on
// modified Fuse contracts. Anyone can create an deploy isolated
// lending and borrowing pools with custom parameters.

import "../solidity-utils/openzeppelin/IERC20.sol";

interface ICToken is IERC20 {
    // Error codes referenced in this file can be found here:
    // https://github.com/compound-finance/compound-protocol/blob/a3214f67b73310d547e00fc578e8355911c9d376/contracts/ErrorReporter.sol
    // solhint-disable-previous-line max-line-length

    /**
     * @dev Underlying asset for this CToken
     */
    function underlying() external view returns (address);

    /**
     * @notice Sender supplies assets into the market and receives cTokens in exchange
     * @dev Accrues interest whether or not the operation succeeds, unless reverted
     * @param mintAmount The amount of the underlying asset to supply
     * @return uint 0=success, otherwise an error code (see ErrorReporter.sol link above for details)
     */
    function mint(uint256 mintAmount) external returns (uint256);

    /**
     * @notice Sender redeems cTokens in exchange for the underlying asset
     * @dev Accrues interest whether or not the operation succeeds, unless reverted
     * @param redeemTokens The number of cTokens to redeem into underlying
     * @return uint 0=success, otherwise an error code (see ErrorReporter.sol link above for details)
     */
    function redeem(uint256 redeemTokens) external returns (uint256);
}
